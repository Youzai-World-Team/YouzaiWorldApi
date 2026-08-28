import { getDomainMailDetail, markDomainMailRead, requireAuth } from '../../../utils/db'
import { buildDomainMailSandboxDocument, domainMailContentDisposition, domainMailHtmlFileName } from '../../../utils/domain-mail-html'
import { UUID_RE } from '../../../utils/game-input'
import { sanitizeEmailHtml } from '../../../utils/html-sanitize'

export default defineEventHandler((event) => {
  const user = requireAuth(event)
  const mailId = String(getQuery(event).mail || '').trim().toLowerCase()
  if (!UUID_RE.test(mailId)) throw createError({ statusCode: 400, statusMessage: '邮件 ID 格式不正确' })

  const detail = getDomainMailDetail(mailId, user.id)
  if (!detail) throw createError({ statusCode: 404, statusMessage: '邮件不存在' })
  if (!detail.htmlBody) throw createError({ statusCode: 404, statusMessage: '这封邮件没有 HTML 正文' })

  const sanitized = sanitizeEmailHtml(detail.htmlBody)
  const document = buildDomainMailSandboxDocument(detail.subject, sanitized, getRequestURL(event).origin)
  const content = Buffer.from(document, 'utf8')
  const filename = domainMailHtmlFileName(detail.subject, detail.id)
  markDomainMailRead(user.id, mailId)

  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Content-Disposition', domainMailContentDisposition('inline', filename))
  setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'; img-src data: https://mcyzw.top https://assets.mcyzw.top https://*.mcyzw.top; style-src 'unsafe-inline'; font-src data:; frame-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'")
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Content-Length', String(content.length))
  return content
})
