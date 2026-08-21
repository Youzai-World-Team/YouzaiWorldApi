import { readRawBody } from 'h3'
import { authenticateGameApiRequest } from '../utils/db'

const MAX_REQUEST_BYTES = 3 * 1024 * 1024
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** 统一保护服务器模组调用的游戏接口：HMAC 签名、时间窗、nonce 防重放与请求体上限。 */
export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/game/')) return

  const contentLengthHeader = getHeader(event, 'content-length')
  const contentLength = Number(contentLengthHeader || 0)
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_REQUEST_BYTES) {
    throw createError({ statusCode: 413, statusMessage: '请求体过大' })
  }

  if (['POST', 'PUT', 'PATCH'].includes(event.method.toUpperCase()) && !contentLengthHeader) {
    throw createError({ statusCode: 411, statusMessage: '请求必须声明 Content-Length' })
  }

  const body = BODY_METHODS.has(event.method.toUpperCase())
    ? (await readRawBody(event, false)) ?? Buffer.alloc(0)
    : Buffer.alloc(0)
  if (body.length > MAX_REQUEST_BYTES) {
    throw createError({ statusCode: 413, statusMessage: '请求体过大' })
  }
  authenticateGameApiRequest(event, body)
})
