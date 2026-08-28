import { requireFeaturePermission } from '../../../utils/db'
import { renderDomainMailComposition } from '../../../utils/domain-mail-composer'
import { buildDomainMailReaderDocument } from '../../../utils/domain-mail-html'
import { sanitizeEmailHtml } from '../../../utils/html-sanitize'

const SUBJECT_MAX = 998

function previewSubject(value: unknown): string {
  const subject = String(value ?? '').trim()
  if (subject.length > SUBJECT_MAX || /[\r\n]/.test(subject)) {
    throw createError({ statusCode: 400, statusMessage: '邮件主题格式不正确' })
  }
  return subject
}

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'domain-mail-send', 'edit')
  const body = await readBody<any>(event)
  const rendered = await renderDomainMailComposition(body)
  const sanitized = sanitizeEmailHtml(rendered.html)

  return {
    document: buildDomainMailReaderDocument(previewSubject(body?.subject), sanitized, getRequestURL(event).origin),
    blockedImages: sanitized.blockedImages,
    truncated: sanitized.truncated,
  }
})
