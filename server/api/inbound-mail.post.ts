import { insertDomainMail, requireInboundMailAuth } from '../utils/db'
import { requireInboundMailPayload } from '../utils/inbound-mail'

/**
 * Cloudflare Email Worker 投递 @mcyzw.top 收件的入口。
 * <p>
 * 签名与体积由 {@code server/middleware/inbound-mail-auth.ts} 校验；这里只做载荷
 * 校验与落库。返回 {@code duplicate} 让 Worker 知道重试命中了同一封信，
 * 不必再退避重发。
 * </p>
 */
export default defineEventHandler(async (event) => {
  requireInboundMailAuth(event)
  const body = await readBody<unknown>(event)
  const payload = requireInboundMailPayload(body)
  const result = insertDomainMail(payload)
  return { ok: true, id: result.id, duplicate: result.duplicate }
})
