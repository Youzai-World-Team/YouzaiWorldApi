import { getHeader, readRawBody } from 'h3'
import {
  deployArchiveLimit,
  deployIsConfigured,
  deployNuxtOutput,
  deployTokenMatches,
  scheduleDeployRestart,
} from '../utils/deploy'

export default defineEventHandler(async (event) => {
  if (!deployIsConfigured()) {
    throw createError({ statusCode: 503, statusMessage: '部署令牌尚未配置，或不符合 32 至 512 位且不含空白字符的要求' })
  }

  if (event.method.toUpperCase() !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: '部署接口只接受 POST' })
  }

  if (!deployTokenMatches(getHeader(event, 'x-deploy-token'))) {
    throw createError({ statusCode: 401, statusMessage: '部署令牌无效' })
  }

  const contentType = (getHeader(event, 'content-type') || '').split(';', 1)[0]?.trim().toLowerCase()
  if (!['application/zip', 'application/octet-stream'].includes(contentType)) {
    throw createError({ statusCode: 415, statusMessage: '部署包必须是 zip 文件' })
  }

  const contentLengthHeader = getHeader(event, 'content-length')
  if (!contentLengthHeader) {
    throw createError({ statusCode: 411, statusMessage: '部署请求必须声明 Content-Length' })
  }
  const contentLength = Number(contentLengthHeader)
  if (!Number.isSafeInteger(contentLength) || contentLength < 1) {
    throw createError({ statusCode: 400, statusMessage: '部署包大小无效' })
  }
  if (contentLength > deployArchiveLimit()) {
    throw createError({ statusCode: 413, statusMessage: '部署包超过 100 MiB 限制' })
  }

  const rawBody = await readRawBody(event, false)
  const archive = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '')
  if (archive.length !== contentLength) {
    throw createError({ statusCode: 400, statusMessage: '部署包大小与 Content-Length 不一致' })
  }
  if (archive.length > deployArchiveLimit()) {
    throw createError({ statusCode: 413, statusMessage: '部署包超过 100 MiB 限制' })
  }

  try {
    const result = await deployNuxtOutput(archive)
    const restart = scheduleDeployRestart()
    return { ok: true, ...result, restart }
  } catch (error) {
    const message = error instanceof Error ? error.message : '部署失败'
    if (message === '已有部署任务正在执行') {
      throw createError({ statusCode: 409, statusMessage: message })
    }
    const archiveRejected = [
      '部署包为空',
      '部署包超过',
      '部署包中没有文件',
      '部署包文件数量过多',
      '部署包包含不安全路径',
      '部署包不允许符号链接',
      '部署包包含重复路径',
      '部署包路径超出暂存目录',
      '部署包解压后超过',
      '部署包缺少 Nuxt 产物',
      'Corrupted zip',
      'Corrupted zip or bug',
      'End of data reached',
      'CRC32 mismatch',
    ].some(prefix => message.includes(prefix))
    throw createError({ statusCode: archiveRejected ? 400 : 500, statusMessage: message })
  }
})
