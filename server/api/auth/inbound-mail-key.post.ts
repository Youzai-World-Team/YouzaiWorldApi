import {
  inboundMailKeySource,
  recordAudit,
  requireFeaturePermission,
  setInboundMailKey,
} from '../../utils/db'

/**
 * 保存域名邮件投递密钥。
 * <p>
 * 保存后要把同一个值写进 Worker 的 {@code INBOUND_MAIL_KEY} Secret，否则签名对不上，
 * 所有收件都会被 401 拒掉。审计日志只记「改过」，不记密钥内容。
 * </p>
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const user = requireFeaturePermission(event, 'settings-inbound-mail-key', 'edit')
  const body = await readBody<{ inboundMailKey?: string }>(event)
  const inboundMailKey = setInboundMailKey(body?.inboundMailKey)
  recordAudit(event, user, '修改域名邮件投递密钥')
  return { inboundMailKey, source: inboundMailKeySource() }
})
