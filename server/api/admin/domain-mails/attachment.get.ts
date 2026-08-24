import { getDomainMailAttachment, requireAuth } from '../../../utils/db'
import { UUID_RE } from '../../../utils/game-input'

/**
 * 下载域名邮件的附件原文。
 * <p>
 * 一律按 {@code application/octet-stream} + {@code Content-Disposition: attachment}
 * 下发，<b>不使用邮件声明的 MIME 类型</b>：陌生人可以往 catch-all 发任意附件，
 * 若照原类型内联返回，一个 HTML 或 SVG 附件就能在 api.mcyzw.top 上执行脚本、
 * 盗取后台会话 Cookie。强制当作二进制下载可以断掉这条路径。
 * </p>
 */

/** 只保留文件名里安全的字符，去掉路径分隔符与引号，避免污染响应头。 */
function asciiFallbackName(filename: string): string {
  const cleaned = filename
    .replace(/[\\/]/g, '_')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["%]/g, '_')
    .trim()
  return cleaned.slice(0, 128) || 'attachment.bin'
}

export default defineEventHandler((event) => {
  requireAuth(event)
  const query = getQuery(event)
  const mailId = String(query.mail || '').trim().toLowerCase()
  const attachmentId = String(query.id || '').trim().toLowerCase()
  if (!UUID_RE.test(mailId)) throw createError({ statusCode: 400, statusMessage: '邮件 ID 格式不正确' })
  if (!UUID_RE.test(attachmentId)) throw createError({ statusCode: 400, statusMessage: '附件 ID 格式不正确' })

  const attachment = getDomainMailAttachment(mailId, attachmentId)
  if (!attachment) throw createError({ statusCode: 404, statusMessage: '附件不存在或未保存内容' })

  const fallback = asciiFallbackName(attachment.filename)
  const encoded = encodeURIComponent(attachment.filename || fallback)
  setResponseHeader(event, 'Content-Type', 'application/octet-stream')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`)
  setResponseHeader(event, 'Content-Length', String(attachment.content.length))
  setResponseHeader(event, 'ETag', `"${attachment.sha256}"`)
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  return attachment.content
})
