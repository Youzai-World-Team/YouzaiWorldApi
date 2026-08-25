import { createError } from 'h3'
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
//
// 面板的计划任务接口官方文档没写，下面的字段是实测结论：
//   name    任务名，同时也是删除时的 task_name
//   count   执行次数，-1 表示无限
//   type    1 = 循环（time 是间隔秒数，最小 3）
//           2 = cron（time 是 5 段或 6 段 cron 表达式）
//           3 = 指定时刻（time 是 "YYYY-MM-DD HH:mm:ss"）
//   actions 动作数组，形如 [{ type, payload }]
//
// 要点：面板对 actions 的结构**不做校验**，原样落库；只有 {type,payload} 这种写法
// 执行器才真的会执行（实测：定时 say 命令确实进了控制台）。写错格式不会报错，
// 任务会到点静默不执行——所以这里把结构固定死，不让调用方自由传。
// 动作名用 start / stop，注意和 HTTP 电源接口的 open 不同名。

export type ScheduleActionType = 'command' | 'start' | 'stop' | 'restart' | 'kill'

const SCHEDULE_ACTION_TYPES = new Set<ScheduleActionType>(['command', 'start', 'stop', 'restart', 'kill'])

export const SCHEDULE_ACTION_LABELS: Record<ScheduleActionType, string> = {
  command: '执行命令',
  start: '启动实例',
  stop: '停止实例',
  restart: '重启实例',
  kill: '强制结束进程',
}

export type ScheduleType = 1 | 2 | 3

export const SCHEDULE_TYPE_LABELS: Record<ScheduleType, string> = {
  1: '按间隔循环',
  2: 'cron 表达式',
  3: '指定时刻执行',
}

const SCHEDULE_NAME_RE = /^[A-Za-z0-9一-龥][A-Za-z0-9一-龥._-]{0,40}$/
const SCHEDULE_INTERVAL_MIN_SECONDS = 3
const SCHEDULE_INTERVAL_MAX_SECONDS = 30 * 24 * 60 * 60
const COMMAND_MAX_LENGTH = 512

export interface ScheduleEntry {
  name: string
  count: number
  type: number
  typeLabel: string
  time: string
  timeLabel: string
  actions: Array<{ type: string; typeLabel: string; payload: string }>
}

function scheduleTimeLabel(type: number, time: string): string {
  if (type === 1) {
    const seconds = Number(time)
    if (!Number.isFinite(seconds)) return time
    if (seconds % 3600 === 0) return `每 ${seconds / 3600} 小时`
    if (seconds % 60 === 0) return `每 ${seconds / 60} 分钟`
    return `每 ${seconds} 秒`
  }
  if (type === 2) return `cron ${time}`
  return time
}

function mapSchedule(raw: any): ScheduleEntry {
  const type = Number(raw?.type) || 0
  const time = String(raw?.time ?? '')
  const actions = Array.isArray(raw?.actions) ? raw.actions : []
  return {
    name: String(raw?.name || ''),
    count: Number(raw?.count ?? 0),
    type,
    typeLabel: SCHEDULE_TYPE_LABELS[type as ScheduleType] || `未知（${type}）`,
    time,
    timeLabel: scheduleTimeLabel(type, time),
    // 面板不校验 actions 结构，历史数据可能是别的形状，这里尽力展示、缺字段就留空。
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

export async function listSchedules(uuid: string, daemonId: string): Promise<ScheduleEntry[]> {
  const data = await callPanel<any>('/api/protected_schedule', { query: { uuid, daemonId } })
  return (Array.isArray(data) ? data : []).map(mapSchedule)
}

export interface ScheduleInput {
  name: unknown
  type: unknown
  time: unknown
  count: unknown
  actionType: unknown
  command: unknown
}

/** 校验并归一化计划任务的时间字段，语义随 type 变。 */
function requireScheduleTime(type: ScheduleType, value: unknown): string {
  if (type === 1) {
    const seconds = Math.trunc(Number(value))
    if (!Number.isFinite(seconds) || seconds < SCHEDULE_INTERVAL_MIN_SECONDS || seconds > SCHEDULE_INTERVAL_MAX_SECONDS) {
      throw createError({
        statusCode: 400,
        statusMessage: `循环间隔需要在 ${SCHEDULE_INTERVAL_MIN_SECONDS} 至 ${SCHEDULE_INTERVAL_MAX_SECONDS} 秒之间`,
      })
    }
    return String(seconds)
  }
  if (type === 2) {
    const cron = String(value ?? '').trim().replace(/\s+/g, ' ')
    const fields = cron.split(' ')
    // 面板同时接受 5 段和 6 段（带秒）两种写法。
    if (fields.length !== 5 && fields.length !== 6) {
      throw createError({ statusCode: 400, statusMessage: 'cron 表达式需要是 5 段或 6 段' })
    }
    if (!/^[0-9*,\-/ ?LW#]+$/.test(cron)) {
      throw createError({ statusCode: 400, statusMessage: 'cron 表达式含有不支持的字符' })
    }
    return cron
  }
  const text = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    throw createError({ statusCode: 400, statusMessage: '执行时刻需要形如 2026-01-01 04:00:00' })
  }
  if (Number.isNaN(Date.parse(text.replace(' ', 'T')))) {
    throw createError({ statusCode: 400, statusMessage: '执行时刻不是有效时间' })
  }
  return text
}

/**
 * 创建计划任务。
 * <p>
 * 面板对同一实例的任务数量有上限，超出时会直接报错（原文透给调用方）。
 * </p>
 */
export async function createSchedule(uuid: string, daemonId: string, input: ScheduleInput): Promise<void> {
  const name = String(input.name ?? '').trim()
  if (!SCHEDULE_NAME_RE.test(name)) {
    throw createError({
      statusCode: 400,
      statusMessage: '任务名只能包含中文、字母、数字、点、下划线和短横线，且不超过 41 个字符',
    })
  }

  const rawType = Number(input.type)
  if (rawType !== 1 && rawType !== 2 && rawType !== 3) {
    throw createError({ statusCode: 400, statusMessage: '计划任务类型无效' })
  }
  const type = rawType as ScheduleType
  const time = requireScheduleTime(type, input.time)

  const rawCount = Math.trunc(Number(input.count))
  // -1 表示无限次；指定时刻类型只可能执行一次。
  const count = type === 3 ? 1 : (rawCount === -1 ? -1 : Math.min(9999, Math.max(1, rawCount || 1)))

  const actionType = String(input.actionType ?? '')
  if (!SCHEDULE_ACTION_TYPES.has(actionType as ScheduleActionType)) {
    throw createError({ statusCode: 400, statusMessage: '计划任务动作无效' })
  }

  let payload = ''
  if (actionType === 'command') {
    payload = String(input.command ?? '').trim()
    if (!payload) {
      throw createError({ statusCode: 400, statusMessage: '执行命令的计划任务必须填写命令' })
    }
    if (payload.length > COMMAND_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(payload)) {
      throw createError({ statusCode: 400, statusMessage: '命令过长或含有换行、控制字符' })
    }
  }

  await callPanel<any>('/api/protected_schedule', {
    method: 'POST',
    query: { uuid, daemonId },
    // actions 必须是 [{type,payload}]：面板不校验结构，写错会到点静默不执行。
    body: { name, count, type, time, actions: [{ type: actionType, payload }] },
  })
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
