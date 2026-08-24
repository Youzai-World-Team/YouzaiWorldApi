import { getDomainMailDetail, requireAuth } from '../../../utils/db'
import { UUID_RE } from '../../../utils/game-input'
import { sanitizeEmailHtml } from '../../../utils/html-sanitize'

/**
 * 后台单封域名邮件详情（只读）：正文、收件人/抄送与附件元信息。
 * <p>
 * 额外返回 {@code htmlSafe}——经允许列表净化后的 HTML，供前端塞进沙箱 iframe 渲染。
 * 原始 {@code htmlBody} 一并保留，用于「查看源码」做钓鱼邮件排查。
 * </p>
 */
export default defineEventHandler((event) => {
  requireAuth(event)
  const id = String(getRouterParam(event, 'id') || '').trim().toLowerCase()
  if (!UUID_RE.test(id)) throw createError({ statusCode: 400, statusMessage: '邮件 ID 格式不正确' })
  const detail = getDomainMailDetail(id)
  if (!detail) throw createError({ statusCode: 404, statusMessage: '邮件不存在' })

  const sanitized = sanitizeEmailHtml(detail.htmlBody)
  return {
    ...detail,
    htmlSafe: sanitized.html,
    htmlSafeCss: sanitized.css,
    htmlBlockedImages: sanitized.blockedImages,
    htmlSafeTruncated: sanitized.truncated,
  }
})
