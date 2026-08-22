import {
  getSmtpTransportSettings,
  issueGameRegistrationEmailCode,
  requireGameApiKey,
  revokeGameRegistrationEmailCode,
} from '../../../utils/db'
import { sendRegistrationVerificationEmail } from '../../../utils/smtp'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const sessionId = body?.session_id ?? body?.sessionId
  const issued = issueGameRegistrationEmailCode(sessionId, body?.email)
  try {
    await sendRegistrationVerificationEmail(
      getSmtpTransportSettings(),
      issued.email,
      issued.username,
      issued.code,
    )
  } catch {
    revokeGameRegistrationEmailCode(sessionId, issued.email, issued.code)
    throw createError({ statusCode: 502, statusMessage: '验证码邮件发送失败，请检查 SMTP 配置后重试' })
  }
  return {
    ok: true,
    msg: '验证码已发送',
    expires_in: issued.expiresInSeconds,
    resend_after: issued.resendAfterSeconds,
  }
})
