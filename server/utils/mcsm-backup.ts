import { createError } from 'h3'
import { callPanel } from './mcsm'

const BACKUP_TASK_NAME = 'instance_backup'
const BACKUP_RULES_PATH = '.epbaklst'
const BACKUP_RULES_MAX_CHARS = 64 * 1024
const BACKUP_TASK_ID_RE = /^[A-Za-z0-9-]{20,200}$/

export const BACKUP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.(?:zip|7z|tar\.gz)$/i

export const DEFAULT_BACKUP_RULES = `$black

# 使用 .gitignore 语法填写不需要进入备份的文件或目录
# 例如：logs/
`

export interface McsmBackupEntry {
  name: string
  size: number
  time: string
}

export interface McsmBackupTask {
  taskId: string
  status: -1 | 0 | 1
  statusLabel: string
  backupFileName: string
}

function requireBackupName(value: unknown): string {
  const name = String(value ?? '').trim()
  if (!BACKUP_NAME_RE.test(name)) {
    throw createError({ statusCode: 400, statusMessage: '备份文件名不合法' })
  }
  return name
}

function requireTaskId(value: unknown): string {
  const taskId = String(value ?? '').trim()
  if (!BACKUP_TASK_ID_RE.test(taskId)) {
    throw createError({ statusCode: 400, statusMessage: '备份任务 ID 不合法' })
  }
  return taskId
}

function taskStatus(value: unknown): -1 | 0 | 1 {
  const status = Number(value)
  if (status === -1 || status === 1) return status
  return 0
}

function mapTask(raw: any): McsmBackupTask | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const detail = raw.detail && typeof raw.detail === 'object' ? raw.detail : raw
  const taskId = String(raw.taskId ?? detail.taskId ?? '')
  if (!BACKUP_TASK_ID_RE.test(taskId)) return null
  const status = taskStatus(raw.status ?? detail.status)
  return {
    taskId,
    status,
    statusLabel: status === 1 ? '正在备份' : status === -1 ? '备份失败' : '备份完成',
    backupFileName: String(detail.backupFileName || ''),
  }
}

/** 读取 ElementsPanel 备份插件维护的实例备份列表。 */
export async function listBackups(uuid: string, daemonId: string): Promise<McsmBackupEntry[]> {
  const data = await callPanel<any>('/api/protected_instance/backup', { query: { uuid, daemonId } })
  return (Array.isArray(data) ? data : [])
    .filter((item: any) => BACKUP_NAME_RE.test(String(item?.name || '')))
    .map((item: any) => ({
      name: String(item.name),
      size: Math.max(0, Number(item.size) || 0),
      time: String(item.time || ''),
    }))
}

/**
 * 启动原生整实例备份任务。该任务会在实例运行时自动停服，调用方必须先确认实例已停止。
 */
export async function startBackup(uuid: string, daemonId: string): Promise<McsmBackupTask> {
  const data = await callPanel<any>('/api/protected_instance/asynchronous', {
    method: 'POST',
    query: { uuid, daemonId, task_name: BACKUP_TASK_NAME },
    body: { time: Date.now(), newInstanceName: '' },
  })
  const task = mapTask(data)
  if (!task) {
    throw createError({ statusCode: 502, statusMessage: 'MCSM 面板没有返回有效的备份任务' })
  }
  return task
}

/** 普通面板用户不能枚举异步任务，但可以凭创建时返回的 taskId 查询。 */
export async function getBackupTask(
  uuid: string,
  daemonId: string,
  taskIdValue: unknown,
): Promise<McsmBackupTask | null> {
  const taskId = requireTaskId(taskIdValue)
  const data = await callPanel<any>('/api/protected_instance/query_asynchronous', {
    method: 'POST',
    query: { uuid, daemonId, task_name: BACKUP_TASK_NAME },
    body: { taskId },
  })
  return mapTask(data)
}

export async function deleteBackup(uuid: string, daemonId: string, nameValue: unknown): Promise<string> {
  const name = requireBackupName(nameValue)
  await callPanel<any>('/api/protected_instance/backup', {
    method: 'DELETE',
    query: { uuid, daemonId, backupName: name },
  })
  return name
}

/** 原生恢复接口会异步解压，并在完成前把实例标记为忙碌。 */
export async function restoreBackup(uuid: string, daemonId: string, nameValue: unknown): Promise<string> {
  const name = requireBackupName(nameValue)
  await callPanel<any>('/api/protected_instance/backup/restore', {
    method: 'POST',
    query: { uuid, daemonId, backupName: name },
  })
  return name
}

/** 读取备份插件的 .epbaklst；文件不存在时返回可直接保存的默认黑名单。 */
export async function getBackupRules(
  uuid: string,
  daemonId: string,
): Promise<{ exists: boolean; text: string }> {
  const data = await callPanel<any>('/api/files/list', {
    query: { uuid, daemonId, target: '/', page: 0, page_size: 100, file_name: BACKUP_RULES_PATH },
  })
  const items = Array.isArray(data?.items) ? data.items : []
  const exists = items.some((item: any) => Number(item?.type) === 1 && String(item?.name) === BACKUP_RULES_PATH)
  if (!exists) return { exists: false, text: DEFAULT_BACKUP_RULES }

  const text = await callPanel<any>('/api/files/', {
    method: 'PUT',
    query: { uuid, daemonId },
    body: { target: BACKUP_RULES_PATH },
  })
  return {
    exists: true,
    text: typeof text === 'string' ? text.slice(0, BACKUP_RULES_MAX_CHARS) : '',
  }
}

export async function setBackupRules(uuid: string, daemonId: string, value: unknown): Promise<string> {
  let text = String(value ?? '').replace(/\r\n?/g, '\n')
  if (text.length > BACKUP_RULES_MAX_CHARS) {
    throw createError({ statusCode: 400, statusMessage: '备份规则内容不能超过 64 KiB' })
  }
  if (text.includes('\u0000')) {
    throw createError({ statusCode: 400, statusMessage: '备份规则不能包含空字符' })
  }
  const firstLine = text.split('\n', 1)[0]?.trim().toLowerCase()
  if (firstLine !== '$black' && firstLine !== '$white') {
    throw createError({ statusCode: 400, statusMessage: '备份规则首行必须是 $black 或 $white' })
  }
  if (!text.endsWith('\n')) text += '\n'

  await callPanel<any>('/api/files/', {
    method: 'PUT',
    query: { uuid, daemonId },
    body: { target: BACKUP_RULES_PATH, text },
  })
  return text
}
