import { readRawBody } from 'h3'
import { authenticateInboundMailRequest } from '../utils/db'

/**
 * 保护 Cloudflare Email Worker 投递收件的接口：HMAC 签名、时间窗、nonce 防重放与请求体上限。
 * <p>
 * 上限比 {@code /api/game/*} 宽得多——一封带附件的邮件 base64 后可达十几 MiB。
 * 签名要覆盖整个请求体，所以必须先把 body 读进内存才能校验；这里先按
 * Content-Length 抢先拒绝超大请求，避免未签名的流量占满内存。
 * </p>
 */
const MAX_REQUEST_BYTES = 20 * 1024 * 1024

export default defineEventHandler(async (event) => {
  if (event.path !== '/api/inbound-mail') return

  if (event.method.toUpperCase() !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: '收件投递只接受 POST' })
  }

  const contentLengthHeader = getHeader(event, 'content-length')
  if (!contentLengthHeader) {
    throw createError({ statusCode: 411, statusMessage: '请求必须声明 Content-Length' })
  }
  const contentLength = Number(contentLengthHeader)
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_REQUEST_BYTES) {
    throw createError({ statusCode: 413, statusMessage: '请求体过大' })
  }

  const body = (await readRawBody(event, false)) ?? Buffer.alloc(0)
  if (body.length > MAX_REQUEST_BYTES) {
    throw createError({ statusCode: 413, statusMessage: '请求体过大' })
  }
  authenticateInboundMailRequest(event, body)
})
