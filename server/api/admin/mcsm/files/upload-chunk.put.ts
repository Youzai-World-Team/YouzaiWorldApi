import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { getMcsmConfig, recordAudit, requireFeaturePermission } from '../../../../utils/db'
import { dataDir } from '../../../../utils/data-dir'
import { assertManagedInstanceAllowed, createManagedInstanceGuard } from '../../../../utils/mcsm'
import { requireFileName, requireInstancePath, UPLOAD_CHUNK_MAX_BYTES, UPLOAD_MAX_BYTES } from '../../../../utils/mcsm-files'
import { assertUploadActive } from '../../../../utils/mcsm-upload'
import { uploadStagedFile } from '../../../../utils/mcsm-upload-target'

const UPLOAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STAGING_DIR = path.join(dataDir, 'upload-staging')
const STAGING_TTL_MS = 6 * 60 * 60 * 1000
const activeUploads = new Set<string>()

function stagedPath(uploadId: string, context: unknown[]): string {
  // 同一上传 ID 不能跨账号、面板、实例或目录续传；密钥只参与摘要，不写入文件名。
  const scope = createHash('sha256').update(JSON.stringify(context)).digest('hex')
  return path.join(STAGING_DIR, `${uploadId.toLowerCase()}-${scope}.part`)
}

async function cleanupStaleUploads(): Promise<void> {
  const names = await readdir(STAGING_DIR).catch(() => [])
  const expiresBefore = Date.now() - STAGING_TTL_MS
  await Promise.all(names.filter((name) => name.endsWith('.part')).map(async (name) => {
    const candidate = path.join(STAGING_DIR, name)
    if (activeUploads.has(candidate)) return
    const info = await stat(candidate).catch(() => null)
    if (info && info.mtimeMs < expiresBefore && !activeUploads.has(candidate)) {
      await rm(candidate, { force: true }).catch(() => {})
    }
  }))
}

export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-files-upload', 'edit')
  const query = getQuery(event)
  const uploadId = String(query.uploadId || '')
  if (!UPLOAD_ID_RE.test(uploadId)) throw createError({ statusCode: 400, statusMessage: '上传会话 ID 无效' })

  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  const instance = await assertManagedInstanceAllowed(uuid, daemonId)
  const assertCurrent = createManagedInstanceGuard(uuid, daemonId)
  const connection = getMcsmConfig()
  const dir = requireInstancePath(query.path)
  const name = requireFileName(query.name)
  const overwriteValue = query.overwrite === undefined ? '0' : String(query.overwrite)
  if (overwriteValue !== '0' && overwriteValue !== '1') {
    throw createError({ statusCode: 400, statusMessage: '上传替换选项无效' })
  }
  const overwrite = overwriteValue === '1'
  const offset = Number(query.offset)
  const total = Number(query.total)
  const finalValue = String(query.final || '')
  if (finalValue !== '0' && finalValue !== '1') {
    throw createError({ statusCode: 400, statusMessage: '上传分块结束标记无效' })
  }
  const final = finalValue === '1'
  if (!/^\d+$/.test(String(query.offset ?? '')) || !/^\d+$/.test(String(query.total ?? ''))
    || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(total)
    || total < 0 || offset > total) {
    throw createError({ statusCode: 400, statusMessage: '上传分块位置或总大小无效' })
  }
  if (total > UPLOAD_MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: `单个文件不能超过 ${Math.floor(UPLOAD_MAX_BYTES / 1024 / 1024)} MiB` })
  }
  // 代理可能不转发 Content-Length，体积限制必须以实际读到的字节为准。
  const lengthHeader = getHeader(event, 'content-length')
  const declaredLength = lengthHeader === undefined ? undefined : Number(lengthHeader)
  if (lengthHeader !== undefined && (!/^\d+$/.test(lengthHeader) || !Number.isSafeInteger(declaredLength))) {
    throw createError({ statusCode: 400, statusMessage: '上传分块长度声明无效' })
  }
  if (declaredLength !== undefined && declaredLength > UPLOAD_CHUNK_MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: '上传分块过大' })
  }

  const filePath = stagedPath(uploadId, [
    user.id, connection.baseUrl, connection.apiKey, uuid.toLowerCase(), daemonId.toLowerCase(), dir, name, total, overwrite,
  ])
  if (activeUploads.has(filePath)) throw createError({ statusCode: 409, statusMessage: '该上传分块正在处理，请勿重复提交' })
  activeUploads.add(filePath)
  const controller = new AbortController()
  const cancel = () => controller.abort()
  const closed = () => { if (!event.node.res.writableEnded) cancel() }
  event.node.req.once('aborted', cancel)
  event.node.res.once('close', closed)
  if (event.node.req.aborted || (event.node.res.destroyed && !event.node.res.writableEnded)) cancel()
  const control = { assertCurrent, signal: controller.signal, overwrite }
  let ownsStaging = false
  let keepStaging = false

  try {
    assertUploadActive(control)
    await mkdir(STAGING_DIR, { recursive: true })
    if (offset === 0) await cleanupStaleUploads()
    let current = 0
    try { current = (await stat(filePath)).size } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (current !== offset) throw createError({ statusCode: 409, statusMessage: '上传分块顺序不正确，请重新上传' })
    ownsStaging = true

    const chunks: Buffer[] = []
    let chunkSize = 0
    for await (const raw of event.node.req) {
      assertUploadActive(control)
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      chunkSize += chunk.length
      if (chunkSize > UPLOAD_CHUNK_MAX_BYTES) throw createError({ statusCode: 413, statusMessage: '上传分块过大' })
      chunks.push(chunk)
    }
    assertUploadActive(control)
    if ((declaredLength !== undefined && declaredLength !== chunkSize) || offset + chunkSize > total
      || (total > 0 && chunkSize === 0)
      || (final ? offset + chunkSize !== total : offset + chunkSize >= total)) {
      throw createError({ statusCode: 400, statusMessage: '上传分块大小或结束位置不匹配' })
    }
    try {
      await appendFile(filePath, Buffer.concat(chunks, chunkSize), { flag: offset === 0 ? 'wx' : 'a' })
    } catch (error: any) {
      if (error?.code === 'EEXIST') {
        ownsStaging = false
        throw createError({ statusCode: 409, statusMessage: '上传会话已存在，请重新上传' })
      }
      throw error
    }
    assertUploadActive(control)
    const written = (await stat(filePath)).size
    if (written !== offset + chunkSize) throw createError({ statusCode: 400, statusMessage: '上传分块大小校验失败' })

    if (!final) {
      keepStaging = true
      return { ok: true, uploaded: written, complete: false }
    }
    const result = await uploadStagedFile(uuid, daemonId, dir, name, filePath, written, control)
    recordAudit(event, user, `上传文件到实例「${instance.nickname || uuid}」：${result.path}（${written} 字节）`)
    return { ok: true, uploaded: written, complete: true, ...result }
  } catch (error: any) {
    if (error?.statusCode) throw error
    assertUploadActive(control)
    throw createError({ statusCode: 500, statusMessage: '上传暂存文件读写失败，请检查 API 数据目录权限和磁盘空间' })
  } finally {
    event.node.req.removeListener('aborted', cancel)
    event.node.res.removeListener('close', closed)
    if (ownsStaging && !keepStaging) await rm(filePath, { force: true }).catch(() => {})
    activeUploads.delete(filePath)
  }
})
