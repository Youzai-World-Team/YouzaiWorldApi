import {
  getSmtpTransportSettings,
  issueGamePasswordResetEmailCode,
  requireGameApiKey,
  revokeGamePasswordResetEmailCode,
} from '../../../utils/db'
import { requireGameUsername } from '../../../utils/game-input'
import { sendPasswordResetVerificationEmail } from '../../../utils/smtp'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const username = requireGameUsername(body?.username)
  const smtp = getSmtpTransportSettings()
  const issued = issueGamePasswordResetEmailCode(username, body?.email)
  try {
    await sendPasswordResetVerificationEmail(
      smtp,
      issued.email,
      issued.username,
      issued.code,
    )
  } catch {
    revokeGamePasswordResetEmailCode(issued.sessionId, issued.email, issued.code)
    throw createError({ statusCode: 502, message: '找回密码验证码邮件发送失败，请稍后重试' })
  }
  return {
    ok: true,
    msg: '验证码已发送',
    session_id: issued.sessionId,
    expires_in: issued.expiresInSeconds,
    resend_after: issued.resendAfterSeconds,
  }
})
