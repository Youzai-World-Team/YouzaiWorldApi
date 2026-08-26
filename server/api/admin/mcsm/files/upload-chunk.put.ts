import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { recordAudit, requirePagePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import {
  fileUploadUrl,
  requireFileName,
  requireInstancePath,
  UPLOAD_CHUNK_MAX_BYTES,
  UPLOAD_MAX_BYTES,
} from '../../../../utils/mcsm-files'
import { forwardFileUpload, openStagedUpload } from '../../../../utils/mcsm-upload'

const UPLOAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STAGING_DIR = path.resolve(process.cwd(), 'server/data/upload-staging')
const STAGING_TTL_MS = 6 * 60 * 60 * 1000

function stagedPath(uploadId: string): string {
  return path.join(STAGING_DIR, `${uploadId}.part`)
}

async function cleanupStaleUploads(): Promise<void> {
  const names = await readdir(STAGING_DIR).catch(() => [])
  const expiresBefore = Date.now() - STAGING_TTL_MS
  await Promise.all(names.filter((name) => name.endsWith('.part')).map(async (name) => {
    const candidate = path.join(STAGING_DIR, name)
    const info = await stat(candidate).catch(() => null)
    if (info && info.mtimeMs < expiresBefore) await rm(candidate, { force: true }).catch(() => {})
  }))
}

export default defineEventHandler(async (event) => {
  const user = requirePagePermission(event, 'server-files', 'edit')
  const query = getQuery(event)
  const uploadId = String(query.uploadId || '')
  if (!UPLOAD_ID_RE.test(uploadId)) {
    throw createError({ statusCode: 400, statusMessage: '上传会话 ID 无效' })
  }

  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)
  const dir = requireInstancePath(query.path)
  const name = requireFileName(query.name)
  const offset = Number(query.offset)
  const total = Number(query.total)
  const finalValue = String(query.final || '')
  if (finalValue !== '0' && finalValue !== '1') {
    throw createError({ statusCode: 400, statusMessage: '上传分块结束标记无效' })
  }
  const final = finalValue === '1'
  const chunkSize = Number(getHeader(event, 'content-length'))

  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(total)
    || total < 0 || offset > total) {
    throw createError({ statusCode: 400, statusMessage: '上传分块位置或总大小无效' })
  }
  if (total > UPLOAD_MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: `单个文件不能超过 ${Math.floor(UPLOAD_MAX_BYTES / 1024 / 1024)} MiB` })
  }
  if (!Number.isFinite(chunkSize) || chunkSize < 0 || chunkSize > UPLOAD_CHUNK_MAX_BYTES
    || offset + chunkSize > total || (final ? offset + chunkSize !== total : offset + chunkSize >= total)) {
    throw createError({ statusCode: 413, statusMessage: '上传分块过大或大小不匹配' })
  }

  const filePath = stagedPath(uploadId)
  await mkdir(STAGING_DIR, { recursive: true })
  if (offset === 0) await cleanupStaleUploads()
  let current = 0
  try {
    current = (await stat(filePath)).size
  } catch {
    // 首个分块还没有临时文件。
  }
  if (current !== offset) {
    throw createError({ statusCode: 409, statusMessage: '上传分块顺序不正确，请重新上传' })
  }

  try {
    await pipeline(event.node.req, createWriteStream(filePath, { flags: 'a' }))
  } catch (error) {
    await rm(filePath, { force: true })
    throw error
  }
  const written = (await stat(filePath)).size
  if (written !== offset + chunkSize) {
    await rm(filePath, { force: true })
    throw createError({ statusCode: 400, statusMessage: '上传分块大小校验失败' })
  }

  if (!final) return { ok: true, uploaded: written, complete: false }

  try {
    const { url } = await fileUploadUrl(uuid, daemonId, dir)
    await forwardFileUpload(url, openStagedUpload(filePath), written, name)
  } finally {
    await rm(filePath, { force: true }).catch(() => {})
  }

  recordAudit(
    event,
    user,
    `上传文件到实例「${instance.nickname || uuid}」：${dir === '/' ? '' : dir}/${name}（${written} 字节）`,
  )
  return { ok: true, uploaded: written, complete: true, path: dir === '/' ? `/${name}` : `${dir}/${name}` }
})
