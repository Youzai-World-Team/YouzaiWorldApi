import { createError } from 'h3'
import { assertInstanceAllowed, callPanel } from './mcsm'
import { requireFileName } from './mcsm-files'

const MOD_PROJECT_TYPE_RE = /^(?:mod|plugin)$/i
const MOD_SOURCE_RE = /^[A-Za-z0-9_-]{1,40}$/
const MOD_HASH_RE = /^[A-Fa-f0-9]{8,128}$/
const MOD_ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/
// Mod tasks may use a relative folder path such as `mods/example.jar`.
const MOD_TASK_FILE_RE = /^(?!.*(?:^|[\\/])\.\.?(?:[\\/]|$))[^\\\u0000-\u001f]{1,240}$/

function requireUrl(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > 2048) {
    throw createError({ statusCode: 400, statusMessage: '下载地址不能为空且不能过长' })
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw createError({ statusCode: 400, statusMessage: '下载地址格式不正确' })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw createError({ statusCode: 400, statusMessage: '下载地址只支持 http 或 https' })
  }
  if (url.username || url.password || ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw createError({ statusCode: 400, statusMessage: '下载地址不允许包含账号密码或本机地址' })
  }
  return url.toString()
}

function requireSource(value: unknown): string {
  const source = String(value ?? '').trim()
  if (source && !MOD_SOURCE_RE.test(source)) {
    throw createError({ statusCode: 400, statusMessage: 'Mod 来源不合法' })
  }
  return source
}

function requireModId(value: unknown): string {
  const id = String(value ?? '').trim()
  if (!MOD_ID_RE.test(id)) throw createError({ statusCode: 400, statusMessage: 'Mod 标识不合法' })
  return id
}

function requireTaskFile(value: unknown): string {
  const file = String(value ?? '').trim()
  if (!MOD_TASK_FILE_RE.test(file)) throw createError({ statusCode: 400, statusMessage: 'Mod 文件名不合法' })
  return file
}

export async function getMinecraftVersions(): Promise<unknown> {
  return callPanel('/api/mod/mc_versions')
}

export async function listMods(uuid: string, daemonId: string, query: Record<string, unknown>): Promise<unknown> {
  await assertInstanceAllowed(uuid, daemonId)
  const page = Math.min(10_000, Math.max(1, Math.trunc(Number(query.page) || 1)))
  const pageSize = Math.min(50, Math.max(1, Math.trunc(Number(query.pageSize) || 50)))
  const folder = query.folder ? String(query.folder).trim() : ''
  if (folder && folder !== 'mods' && folder !== 'plugins') {
    throw createError({ statusCode: 400, statusMessage: 'Mod 目录只能是 mods 或 plugins' })
  }
  return callPanel('/api/mod/list', { query: { uuid, daemonId, page, pageSize, folder } })
}

export async function getModInfo(hash: unknown): Promise<unknown> {
  const value = String(hash ?? '').trim()
  if (!MOD_HASH_RE.test(value)) throw createError({ statusCode: 400, statusMessage: 'Mod 哈希不合法' })
  return callPanel('/api/mod/info', { query: { hash: value } })
}

export async function getModBatchInfo(hashes: unknown): Promise<unknown> {
  if (!Array.isArray(hashes) || hashes.length === 0 || hashes.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'Mod 哈希列表需要包含 1 至 100 项' })
  }
  const values = hashes.map((hash) => String(hash).trim())
  if (values.some((hash) => !MOD_HASH_RE.test(hash))) {
    throw createError({ statusCode: 400, statusMessage: 'Mod 哈希列表包含不合法值' })
  }
  return callPanel('/api/mod/batch_info', { method: 'POST', body: { hashes: values } })
}

export async function searchMods(query: Record<string, unknown>): Promise<unknown> {
  const text = String(query.query ?? '').trim().slice(0, 200)
  const offset = Math.min(100_000, Math.max(0, Math.trunc(Number(query.offset) || 0)))
  const limit = Math.min(50, Math.max(1, Math.trunc(Number(query.limit) || 20)))
  return callPanel('/api/mod/search', {
    query: {
      query: text,
      offset,
      limit,
      source: requireSource(query.source) || 'all',
      version: String(query.version ?? '').trim().slice(0, 40),
      type: String(query.type ?? 'all').trim().slice(0, 40) || 'all',
      loader: String(query.loader ?? 'all').trim().slice(0, 40) || 'all',
      environment: String(query.environment ?? 'all').trim().slice(0, 40) || 'all',
    },
  })
}

export async function getModVersions(projectId: unknown, source: unknown): Promise<unknown> {
  return callPanel('/api/mod/versions', {
    query: { projectId: requireModId(projectId), source: requireSource(source) || 'Modrinth' },
  })
}

export async function installMod(uuid: string, daemonId: string, input: Record<string, unknown>): Promise<unknown> {
  await assertInstanceAllowed(uuid, daemonId)
  const projectType = String(input.projectType ?? input.type ?? 'mod').trim().toLowerCase()
  if (!MOD_PROJECT_TYPE_RE.test(projectType)) {
    throw createError({ statusCode: 400, statusMessage: 'Mod 类型只能是 mod 或 plugin' })
  }
  const body = {
    daemonId,
    uuid,
    url: requireUrl(input.url),
    fileName: requireFileName(input.fileName),
    projectType,
    fallbackUrl: input.fallbackUrl ? requireUrl(input.fallbackUrl) : undefined,
    extraInfo: input.extraInfo && typeof input.extraInfo === 'object' ? input.extraInfo : undefined,
  }
  return callPanel('/api/mod/download', { method: 'POST', body })
}

export async function stopModTransfer(uuid: string, daemonId: string, input: Record<string, unknown>): Promise<unknown> {
  await assertInstanceAllowed(uuid, daemonId)
  const type = String(input.type ?? 'download')
  if (type !== 'download' && type !== 'upload') {
    throw createError({ statusCode: 400, statusMessage: '传输类型只能是 download 或 upload' })
  }
  return callPanel('/api/mod/stop_transfer', {
    method: 'POST',
    body: {
      uuid,
      daemonId,
      fileName: requireTaskFile(input.fileName),
      type,
      uploadId: input.uploadId ? String(input.uploadId) : undefined,
    },
  })
}

export async function getModConfigFiles(
  uuid: string,
  daemonId: string,
  modId: unknown,
  type: unknown,
  fileName: unknown,
): Promise<unknown> {
  await assertInstanceAllowed(uuid, daemonId)
  return callPanel('/api/mod/config_files', {
    query: {
      uuid,
      daemonId,
      modId: requireModId(modId),
      type: String(type ?? 'mod').trim().slice(0, 40),
      fileName: requireTaskFile(fileName),
    },
  })
}

export async function toggleMod(uuid: string, daemonId: string, fileName: unknown): Promise<unknown> {
  await assertInstanceAllowed(uuid, daemonId)
  return callPanel('/api/mod/toggle', {
    method: 'POST',
    body: { uuid, daemonId, fileName: requireTaskFile(fileName) },
  })
}

export async function deleteMod(uuid: string, daemonId: string, fileName: unknown): Promise<unknown> {
  await assertInstanceAllowed(uuid, daemonId)
  return callPanel('/api/mod/delete', {
    method: 'POST',
    body: { uuid, daemonId, fileName: requireTaskFile(fileName) },
  })
}
