import { getDomainMailSentDetail, requireAuth } from '../../../../utils/db'
import { UUID_RE } from '../../../../utils/game-input'
import { sanitizeEmailHtml } from '../../../../utils/html-sanitize'

export default defineEventHandler((event) => {
  const user = requireAuth(event)
  const id = String(getRouterParam(event, 'id') || '').trim().toLowerCase()
  if (!UUID_RE.test(id)) throw createError({ statusCode: 400, statusMessage: '已发送邮件 ID 格式不正确' })
  const detail = getDomainMailSentDetail(id, user.id)
  if (!detail) throw createError({ statusCode: 404, statusMessage: '已发送邮件不存在' })
  const sanitized = sanitizeEmailHtml(detail.htmlBody)
  return {
    ...detail,
    htmlSafe: sanitized.html,
    htmlSafeCss: sanitized.css,
    htmlBlockedImages: sanitized.blockedImages,
    htmlSafeTruncated: sanitized.truncated,
  }
})
