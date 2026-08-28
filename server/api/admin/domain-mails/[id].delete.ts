import { deleteDomainMail, getDomainMailDetail, recordAudit, requireFeaturePermission } from '../../../utils/db'
import { UUID_RE } from '../../../utils/game-input'

/** 删除一封域名邮件，附件一并删除。 */
export default defineEventHandler((event) => {
  const user = requireFeaturePermission(event, 'domain-mail-delete', 'edit')
  const id = String(getRouterParam(event, 'id') || '').trim().toLowerCase()
  if (!UUID_RE.test(id)) throw createError({ statusCode: 400, statusMessage: '邮件 ID 格式不正确' })

  // 先取主题写进操作记录：删除之后就查不到了。
  const detail = getDomainMailDetail(id)
  if (!detail) throw createError({ statusCode: 404, statusMessage: '邮件不存在' })
  if (!deleteDomainMail(id)) throw createError({ statusCode: 404, statusMessage: '邮件不存在' })

  recordAudit(event, user, `删除域名邮件：${detail.subject || '(无主题)'}（来自 ${detail.fromAddress || '未知发件人'}）`)
  return { ok: true }
})
