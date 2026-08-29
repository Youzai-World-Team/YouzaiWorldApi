import {
  buildVerificationEmailFromTemplate,
} from '../../utils/smtp'
import { requirePagePermission } from '../../utils/db'
import {
  DEFAULT_VERIFICATION_EMAIL_TEMPLATES,
  resolveVerificationEmailTemplate,
  VERIFICATION_EMAIL_TEMPLATE_KINDS,
  type VerificationEmailTemplateKind,
} from '../../utils/email-templates'
import { addEmailPreviewScrollbar } from '../../utils/email-preview-scrollbar'
import { getRequestURL } from 'h3'
export default defineEventHandler(async (event) => {
  const user = requirePagePermission(event, 'game-accounts', 'view')
  const body = await readBody<any>(event)
  const kind = String(body?.type || 'registration') as VerificationEmailTemplateKind
  if (!VERIFICATION_EMAIL_TEMPLATE_KINDS.includes(kind)) {
    throw createError({ statusCode: 400, statusMessage: '不支持的验证码邮件类型' })
  }

  let template
  try {
    template = resolveVerificationEmailTemplate(body?.template, DEFAULT_VERIFICATION_EMAIL_TEMPLATES[kind])
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : '邮件模板格式不正确' })
  }
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Content-Type', 'text/html; charset=UTF-8')
  return addEmailPreviewScrollbar(buildVerificationEmailFromTemplate(
    template,
    user.fullName || user.username,
    '123456',
    `${getRequestURL(event).origin}/images/uzw-tm.png`,
  ))
})
