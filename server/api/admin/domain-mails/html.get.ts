import { getDomainMailDetail, requireAuth } from '../../../utils/db'
import { domainMailContentDisposition, domainMailHtmlFileName } from '../../../utils/domain-mail-html'
import { UUID_RE } from '../../../utils/game-input'

export default defineEventHandler((event) => {
  requireAuth(event)
  const mailId = String(getQuery(event).mail || '').trim().toLowerCase()
  if (!UUID_RE.test(mailId)) throw createError({ statusCode: 400, statusMessage: '邮件 ID 格式不正确' })

  const detail = getDomainMailDetail(mailId)
  if (!detail) throw createError({ statusCode: 404, statusMessage: '邮件不存在' })
  if (!detail.htmlBody) throw createError({ statusCode: 404, statusMessage: '这封邮件没有 HTML 正文' })

  const content = Buffer.from(detail.htmlBody, 'utf8')
  const filename = domainMailHtmlFileName(detail.subject, detail.id)
  setResponseHeader(event, 'Content-Type', 'application/octet-stream')
  setResponseHeader(event, 'Content-Disposition', domainMailContentDisposition('attachment', filename))
  setResponseHeader(event, 'Content-Length', String(content.length))
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  return content
})
