import { createError } from 'h3'
import { listBackups } from './mcsm-backup'
import { assertInstanceAllowed, callPanel } from './mcsm'

/**
 * MCSManager 面板里「实例配置 / 计划任务 / 文件」这三块的客户端。
 * <p>
 * 与 {@code mcsm.ts} 共用同一个 {@link callPanel} 出口（ApiKey 拼装与错误映射都在那边），
 * 这里只负责各自的参数校验和返回值裁剪。每个写操作都由接口层先过
 * {@link assertInstanceAllowed}，确保实例属于当前 ApiKey。
 * </p>
 * <p>
 * 下面这些字段名和取值都是拿真实面板（10.12.5）实测出来的，官方 API 文档没有覆盖
 * 计划任务和实例配置文件这两块，改动前先看注释里记的实测结论。
 * </p>
 */

// ===== server.properties =====

// 面板把 server.properties 解析成带类型的 JSON 回来（实例是 MC 服时约 70 项）。
// 这里限制单次提交的规模，避免把面板的配置文件写成一个畸形大对象。
const PROPERTIES_MAX_KEYS = 300
const PROPERTIES_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/
const PROPERTIES_VALUE_MAX = 2048

/** 面板支持的配置文件类型；缺 type 会 500，所以必须显式带上。 */
export type ConfigFileType = 'properties' | 'json' | 'yml'

// 只放行实例根目录下这几个已知的配置文件：这个接口能读写实例目录内的文件，
// 不加白名单就等于开放了任意配置文件改写。
const CONFIG_FILES: Array<{ fileName: string; type: ConfigFileType; label: string }> = [
  { fileName: 'server.properties', type: 'properties', label: '服务器属性' },
]

export function listConfigFiles() {
  return CONFIG_FILES.map((item) => ({ ...item }))
}

function requireConfigFile(fileNameValue: unknown): { fileName: string; type: ConfigFileType } {
  const fileName = String(fileNameValue ?? '').trim()
  const matched = CONFIG_FILES.find((item) => item.fileName === fileName)
  if (!matched) {
    throw createError({ statusCode: 400, statusMessage: '不支持编辑该配置文件' })
  }
  return { fileName: matched.fileName, type: matched.type }
}

/** 读取解析后的配置文件。面板返回的是带类型的键值对，布尔和数字都已还原。 */
export async function getConfigFile(
  uuid: string,
  daemonId: string,
  fileNameValue: unknown,
): Promise<Record<string, unknown>> {
  const { fileName, type } = requireConfigFile(fileNameValue)
  const data = await callPanel<any>('/api/protected_instance/process_config/file', {
    query: { uuid, daemonId, fileName, type },
  })
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw createError({ statusCode: 502, statusMessage: 'MCSM 面板返回的配置文件格式无法识别' })
  }
  return data as Record<string, unknown>
}

/**
 * 写回配置文件。
 * <p>
 * 面板是整份覆盖写，所以调用方必须先读、改完再整份提交。这里逐项校验键名与取值类型，
 * 只允许字符串 / 数字 / 布尔 / null——多层嵌套对象写进 properties 文件没有意义，
 * 而且会被面板序列化成 {@code [object Object]}。
 * </p>
 */
export async function setConfigFile(
  uuid: string,
  daemonId: string,
  fileNameValue: unknown,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const { fileName, type } = requireConfigFile(fileNameValue)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createError({ statusCode: 400, statusMessage: '配置内容格式不正确' })
  }
  const entries = Object.entries(payload as Record<string, unknown>)
  if (entries.length === 0 || entries.length > PROPERTIES_MAX_KEYS) {
    throw createError({ statusCode: 400, statusMessage: `配置项数量需要在 1 至 ${PROPERTIES_MAX_KEYS} 之间` })
  }

  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of entries) {
    if (!PROPERTIES_KEY_RE.test(key)) {
      throw createError({ statusCode: 400, statusMessage: `配置项名称不合法：${key}` })
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      cleaned[key] = value
      continue
    }
    if (typeof value === 'string') {
      // 换行会把一行配置拆成两行，等于凭空插入配置项。
      if (value.length > PROPERTIES_VALUE_MAX || /[\r\n]/.test(value)) {
        throw createError({ statusCode: 400, statusMessage: `配置项「${key}」的值过长或含有换行` })
      }
      cleaned[key] = value
      continue
    }
    throw createError({ statusCode: 400, statusMessage: `配置项「${key}」的值类型不受支持` })
  }

  await callPanel<any>('/api/protected_instance/process_config/file', {
    method: 'PUT',
    query: { uuid, daemonId, fileName, type },
    body: cleaned,
  })
  return getConfigFile(uuid, daemonId, fileName)
}

// ===== 计划任务 =====
// ElementsPanel 的 type 2 与 type 3 最终都交给 node-schedule。面板前端分别生成：
//   type 2: 秒 分 时 * * 星期
//   type 3: 秒 分 时 日 月 *（年份不会进入表达式，执行下一次匹配后由 count=1 删除）

export type ScheduleActionType = 'delay' | 'command' | 'stop' | 'start' | 'restart' | 'kill' | 'backup'

const SCHEDULE_ACTION_TYPES = new Set<ScheduleActionType>([
  'delay', 'command', 'stop', 'start', 'restart', 'kill', 'backup',
])

export const SCHEDULE_ACTION_LABELS: Record<ScheduleActionType, string> = {
  delay: '延迟',
  command: '执行命令',
  stop: '停止实例',
  start: '启动实例',
  restart: '重启实例',
  kill: '强制结束进程',
  backup: '创建整实例备份',
}

export type ScheduleType = 1 | 2 | 3

export const SCHEDULE_TYPE_LABELS: Record<ScheduleType, string> = {
  1: '固定间隔',
  2: '每周循环',
  3: '指定月日',
}

const SCHEDULE_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,40}$/u
const SCHEDULE_INTERVAL_MIN_SECONDS = 3
const SCHEDULE_INTERVAL_MAX_SECONDS = 30 * 24 * 60 * 60
const SCHEDULE_ACTION_MAX = 10
const SCHEDULE_COUNT_MAX = 9999
const SCHEDULE_DELAY_MAX_MS = 24 * 60 * 60 * 1000
const COMMAND_MAX_LENGTH = 512
const WEEKDAY_LABELS: Record<number, string> = {
  1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日',
}

interface PanelScheduleAction {
  type: string
  payload: string
}

interface PanelScheduleTask {
  name: string
  count: number
  time: string
  actions: PanelScheduleAction[]
  type: number
}

export interface ScheduleEntry {
  name: string
  count: number
  type: number
  typeLabel: string
  time: string
  timeLabel: string
  actions: Array<{ type: string; typeLabel: string; payload: string }>
}

export interface ScheduleInput {
  name: unknown
  type: unknown
  time: unknown
  count: unknown
  actions: unknown
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

function weeklyTimeParts(time: string): { seconds: number; minutes: number; hours: number; weekdays: number[] } | null {
  const match = time.match(/^(\d{1,2}) (\d{1,2}) (\d{1,2}) \* \* ([1-7](?:,[1-7])*)$/)
  if (!match) return null
  const seconds = Number(match[1])
  const minutes = Number(match[2])
  const hours = Number(match[3])
  const weekdays = [...new Set(match[4]!.split(',').map(Number))].sort((a, b) => a - b)
  if (seconds > 59 || minutes > 59 || hours > 23 || weekdays.length === 0) return null
  return { seconds, minutes, hours, weekdays }
}

function specifiedTimeParts(time: string): { seconds: number; minutes: number; hours: number; day: number; month: number } | null {
  const match = time.match(/^(\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2}) \*$/)
  if (!match) return null
  const seconds = Number(match[1])
  const minutes = Number(match[2])
  const hours = Number(match[3])
  const day = Number(match[4])
  const month = Number(match[5])
  if (seconds > 59 || minutes > 59 || hours > 23 || month < 1 || month > 12) return null
  const probe = new Date(Date.UTC(2024, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  return { seconds, minutes, hours, day, month }
}

function scheduleTimeLabel(type: number, time: string): string {
  if (type === 1) {
    const seconds = Number(time)
    if (!Number.isFinite(seconds)) return time
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const rest = seconds % 60
    return `每 ${[
      days ? `${days} 天` : '',
      hours ? `${hours} 小时` : '',
      minutes ? `${minutes} 分钟` : '',
      rest ? `${rest} 秒` : '',
    ].filter(Boolean).join(' ')}`
  }
  if (type === 2) {
    const parsed = weeklyTimeParts(time)
    if (!parsed) return `cron ${time}`
    const at = `${twoDigits(parsed.hours)}:${twoDigits(parsed.minutes)}:${twoDigits(parsed.seconds)}`
    return `${parsed.weekdays.map((day) => WEEKDAY_LABELS[day]).join('、')} ${at}`
  }
  if (type === 3) {
    const parsed = specifiedTimeParts(time)
    if (!parsed) return `cron ${time}`
    const at = `${twoDigits(parsed.hours)}:${twoDigits(parsed.minutes)}:${twoDigits(parsed.seconds)}`
    return `${parsed.month} 月 ${parsed.day} 日 ${at}（下一次）`
  }
  return time
}

function mapSchedule(raw: any): ScheduleEntry {
  const type = Number(raw?.type) || 0
  const time = String(raw?.time ?? '')
  const rawCount = raw?.count
  const parsedCount = Number(rawCount)
  const actions = Array.isArray(raw?.actions) ? raw.actions : []
  return {
    name: String(raw?.name || ''),
    count: String(rawCount ?? '') === '' || !Number.isFinite(parsedCount) ? -1 : parsedCount,
    type,
    typeLabel: SCHEDULE_TYPE_LABELS[type as ScheduleType] || `未知（${type}）`,
    time,
    timeLabel: scheduleTimeLabel(type, time),
    actions: actions.map((action: any) => {
      const actionType = String(action?.type ?? action?.action ?? (typeof action === 'string' ? 'command' : ''))
      return {
        type: actionType,
        typeLabel: SCHEDULE_ACTION_LABELS[actionType as ScheduleActionType] || actionType || '未知动作',
        payload: String(action?.payload ?? (typeof action === 'string' ? action : '')),
      }
    }),
  }
}

async function listPanelSchedules(uuid: string, daemonId: string): Promise<any[]> {
  const data = await callPanel<any>('/api/protected_schedule', { query: { uuid, daemonId } })
  return Array.isArray(data) ? data : []
}

export async function listSchedules(uuid: string, daemonId: string): Promise<ScheduleEntry[]> {
  return (await listPanelSchedules(uuid, daemonId)).map(mapSchedule)
}

function requireScheduleTime(type: ScheduleType, value: unknown): string {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (type === 1) {
    const seconds = Math.trunc(Number(text))
    if (!Number.isFinite(seconds) || seconds < SCHEDULE_INTERVAL_MIN_SECONDS || seconds > SCHEDULE_INTERVAL_MAX_SECONDS) {
      throw createError({
        statusCode: 400,
        statusMessage: `固定间隔需要在 ${SCHEDULE_INTERVAL_MIN_SECONDS} 至 ${SCHEDULE_INTERVAL_MAX_SECONDS} 秒之间`,
      })
    }
    return String(seconds)
  }
  if (type === 2) {
    const parsed = weeklyTimeParts(text)
    if (!parsed) {
      throw createError({ statusCode: 400, statusMessage: '每周循环时间格式不正确' })
    }
    return `${parsed.seconds} ${parsed.minutes} ${parsed.hours} * * ${parsed.weekdays.join(',')}`
  }
  const parsed = specifiedTimeParts(text)
  if (!parsed) {
    throw createError({ statusCode: 400, statusMessage: '指定月日的时间格式不正确' })
  }
  return `${parsed.seconds} ${parsed.minutes} ${parsed.hours} ${parsed.day} ${parsed.month} *`
}

function requireScheduleActions(value: unknown): PanelScheduleAction[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > SCHEDULE_ACTION_MAX) {
    throw createError({ statusCode: 400, statusMessage: `计划任务需要包含 1 至 ${SCHEDULE_ACTION_MAX} 个动作` })
  }
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw createError({ statusCode: 400, statusMessage: `第 ${index + 1} 个动作格式不正确` })
    }
    const actionType = String((raw as any).type ?? '') as ScheduleActionType
    if (!SCHEDULE_ACTION_TYPES.has(actionType)) {
      throw createError({ statusCode: 400, statusMessage: `第 ${index + 1} 个计划任务动作无效` })
    }
    let payload = String((raw as any).payload ?? '').trim()
    if (actionType === 'command') {
      if (!payload || payload.length > COMMAND_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(payload)) {
        throw createError({ statusCode: 400, statusMessage: `第 ${index + 1} 个动作的命令为空、过长或含有控制字符` })
      }
    } else if (actionType === 'delay') {
      const delay = Math.trunc(Number(payload))
      if (!Number.isFinite(delay) || delay < 1 || delay > SCHEDULE_DELAY_MAX_MS) {
        throw createError({ statusCode: 400, statusMessage: `第 ${index + 1} 个延迟需要在 1 至 ${SCHEDULE_DELAY_MAX_MS} 毫秒之间` })
      }
      payload = String(delay)
    } else {
      payload = ''
    }
    return { type: actionType, payload }
  })
}

function normalizeSchedule(input: ScheduleInput): PanelScheduleTask {
  const name = String(input.name ?? '').trim()
  if (!SCHEDULE_NAME_RE.test(name)) {
    throw createError({
      statusCode: 400,
      statusMessage: '任务名只能包含文字、数字、点、下划线和短横线，且不超过 41 个字符',
    })
  }
  const rawType = Number(input.type)
  if (rawType !== 1 && rawType !== 2 && rawType !== 3) {
    throw createError({ statusCode: 400, statusMessage: '计划任务类型无效' })
  }
  const type = rawType as ScheduleType
  const rawCount = Math.trunc(Number(input.count))
  const count = type === 3 ? 1 : rawCount === -1 ? -1 : Math.min(SCHEDULE_COUNT_MAX, Math.max(1, rawCount || 1))
  return {
    name,
    count,
    type,
    time: requireScheduleTime(type, input.time),
    actions: requireScheduleActions(input.actions),
  }
}

async function assertBackupActionSupported(uuid: string, daemonId: string, task: PanelScheduleTask): Promise<void> {
  if (task.actions.some((action) => action.type === 'backup')) {
    await listBackups(uuid, daemonId)
  }
}

async function registerSchedule(uuid: string, daemonId: string, task: PanelScheduleTask): Promise<void> {
  await callPanel<any>('/api/protected_schedule', {
    method: 'POST',
    query: { uuid, daemonId },
    body: task,
  })
}

export async function createSchedule(uuid: string, daemonId: string, input: ScheduleInput): Promise<ScheduleEntry> {
  const task = normalizeSchedule(input)
  await assertBackupActionSupported(uuid, daemonId, task)
  await registerSchedule(uuid, daemonId, task)
  return mapSchedule(task)
}

/** 面板没有更新接口；先校验新任务，再删除并重建，失败时尽力恢复旧配置。 */
export async function replaceSchedule(uuid: string, daemonId: string, input: ScheduleInput): Promise<ScheduleEntry> {
  const task = normalizeSchedule(input)
  await assertBackupActionSupported(uuid, daemonId, task)
  const current = (await listPanelSchedules(uuid, daemonId)).find((item) => String(item?.name || '') === task.name)
  if (!current) {
    throw createError({ statusCode: 404, statusMessage: '计划任务不存在或已被删除' })
  }

  await deleteSchedule(uuid, daemonId, task.name)
  try {
    await registerSchedule(uuid, daemonId, task)
  } catch (error) {
    try {
      await registerSchedule(uuid, daemonId, {
        name: String(current.name),
        count: String(current.count ?? '') === '' || !Number.isFinite(Number(current.count))
          ? -1
          : Number(current.count),
        type: Number(current.type),
        time: String(current.time),
        actions: Array.isArray(current.actions) ? current.actions : [],
      })
    } catch {
      // 原错误对调用方更有价值；回滚失败会在操作记录与下一次刷新中暴露。
    }
    throw error
  }
  return mapSchedule(task)
}

export async function deleteSchedule(uuid: string, daemonId: string, nameValue: unknown): Promise<void> {
  const name = String(nameValue ?? '').trim()
  if (!SCHEDULE_NAME_RE.test(name)) {
    throw createError({ statusCode: 400, statusMessage: '任务名不合法' })
  }
  await callPanel<any>('/api/protected_schedule', {
    method: 'DELETE',
    query: { uuid, daemonId, task_name: name },
  })
}


/** 供接口层复用：先确认实例归属，再返回规范化后的实例信息。 */
export async function requireInstance(uuid: string, daemonId: string) {
  return assertInstanceAllowed(uuid, daemonId)
}
