import { createError } from 'h3'
import { assertInstanceAllowed, callPanel } from './mcsm'
import { requireInstancePath } from './mcsm-files'

const TASK_NAME_RE = /^[A-Za-z0-9_.-]{1,80}$/
const MAX_CONFIG_FILES = 100

export interface ProcessConfigFile {
  file: string
  check: boolean
  [key: string]: unknown
}

export async function listProcessConfigFiles(uuid: string, daemonId: string, files: unknown): Promise<ProcessConfigFile[]> {
  await assertInstanceAllowed(uuid, daemonId)
  const requested = Array.isArray(files)
    ? [...new Set(files.map((value) => String(value).trim()).filter(Boolean).map((value) => requireInstancePath(value, { allowRoot: false })))].slice(0, MAX_CONFIG_FILES)
    : []
  const data = await callPanel<any>('/api/protected_instance/process_config/list', {
    method: 'POST',
    query: { uuid, daemonId },
    body: { files: requested },
  })
  return Array.isArray(data) ? data as ProcessConfigFile[] : []
}

function requireConfigFile(value: unknown): string {
  return requireInstancePath(value, { allowRoot: false })
}

function requireConfigType(value: unknown): string {
  const type = String(value ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(type)) {
    throw createError({ statusCode: 400, statusMessage: '配置文件类型不合法' })
  }
  return type
}

export async function readProcessConfigFile(
  uuid: string,
  daemonId: string,
  fileName: unknown,
  type: unknown,
): Promise<unknown> {
  await assertInstanceAllowed(uuid, daemonId)
  return callPanel('/api/protected_instance/process_config/file', {
    query: { uuid, daemonId, fileName: requireConfigFile(fileName), type: requireConfigType(type) },
  })
}

export async function writeProcessConfigFile(
  uuid: string,
  daemonId: string,
  fileName: unknown,
  type: unknown,
  config: unknown,
): Promise<unknown> {
  await assertInstanceAllowed(uuid, daemonId)
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw createError({ statusCode: 400, statusMessage: '配置内容必须是对象' })
  }
  return callPanel('/api/protected_instance/process_config/file', {
    method: 'PUT',
    query: { uuid, daemonId, fileName: requireConfigFile(fileName), type: requireConfigType(type) },
    body: config,
  })
}

const ALLOWED_INSTANCE_UPDATE_KEYS = new Set([
  'rconIp', 'rconPort', 'rconPassword', 'enableRcon', 'pingConfig', 'eventTask',
  'terminalOption', 'extraServiceConfig', 'crlf', 'oe', 'ie', 'stopCommand',
  'fileCode',
])

function normalizeInstanceUpdate(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: '实例设置格式不正确' })
  }
  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(input)) {
    if (!ALLOWED_INSTANCE_UPDATE_KEYS.has(key)) continue
    output[key] = raw
  }
  if (Object.keys(output).length === 0) {
    throw createError({ statusCode: 400, statusMessage: '没有可更新的实例设置' })
  }
  return output
}

export async function updateInstanceSettings(uuid: string, daemonId: string, value: unknown): Promise<void> {
  await assertInstanceAllowed(uuid, daemonId)
  await callPanel('/api/protected_instance/instance_update', {
    method: 'PUT',
    query: { uuid, daemonId },
    body: normalizeInstanceUpdate(value),
  })
}

function requireTaskName(value: unknown): string {
  const name = String(value ?? '').trim()
  if (!TASK_NAME_RE.test(name)) {
    throw createError({ statusCode: 400, statusMessage: '异步任务名称不合法' })
  }
  return name
}

export async function startInstanceAsyncTask(
  uuid: string,
  daemonId: string,
  taskName: unknown,
  parameter: unknown,
): Promise<unknown> {
  await assertInstanceAllowed(uuid, daemonId)
  const normalizedTaskName = requireTaskName(taskName)
  // ElementsPanel explicitly reserves quick_install for elevated accounts.
  // Keep that administrator-only task out of this ordinary-user adapter even
  // if a caller manually types the task name instead of using the UI.
  if (normalizedTaskName.toLowerCase() === 'quick_install') {
    throw createError({ statusCode: 403, statusMessage: 'quick_install 仅允许面板管理员执行' })
  }
  return callPanel('/api/protected_instance/asynchronous', {
    method: 'POST',
    query: { uuid, daemonId, task_name: normalizedTaskName },
    body: parameter && typeof parameter === 'object' ? parameter : {},
  })
}

export async function stopInstanceAsyncTask(uuid: string, daemonId: string, parameter: unknown): Promise<unknown> {
  await assertInstanceAllowed(uuid, daemonId)
  return callPanel('/api/protected_instance/stop_asynchronous', {
    method: 'POST',
    query: { uuid, daemonId },
    body: parameter && typeof parameter === 'object' ? parameter : {},
  })
}

export async function queryInstanceAsyncTask(
  uuid: string,
  daemonId: string,
  taskName: unknown,
  parameter: unknown,
): Promise<unknown> {
  await assertInstanceAllowed(uuid, daemonId)
  return callPanel('/api/protected_instance/query_asynchronous', {
    method: 'POST',
    query: { uuid, daemonId, task_name: requireTaskName(taskName) },
    body: parameter && typeof parameter === 'object' ? parameter : {},
  })
}
