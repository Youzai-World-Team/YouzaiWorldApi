import {
  buildVerificationEmailFromTemplate,
} from '../../utils/smtp'
import { getVerificationEmailTemplates, requirePagePermission } from '../../utils/db'
import type { VerificationEmailTemplateKind } from '../../utils/email-templates'
import { addEmailPreviewScrollbar } from '../../utils/email-preview-scrollbar'
import { webAssetUrl } from '#shared/web-assets'

const PREVIEW_KINDS: VerificationEmailTemplateKind[] = [
  'registration',
  'password-reset',
  'email-change',
]

export default defineEventHandler((event) => {
  const user = requirePagePermission(event, 'game-accounts', 'view')
  const requestedKind = String(getQuery(event).type || 'registration') as VerificationEmailTemplateKind
  if (!PREVIEW_KINDS.includes(requestedKind)) {
    throw createError({ statusCode: 400, statusMessage: '不支持的验证码邮件类型' })
  }

  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Content-Type', 'text/html; charset=UTF-8')
  return addEmailPreviewScrollbar(buildVerificationEmailFromTemplate(
    getVerificationEmailTemplates()[requestedKind],
    user.fullName || user.username,
    '123456',
    webAssetUrl('/images/uzw-tm.png'),
  ))
})
