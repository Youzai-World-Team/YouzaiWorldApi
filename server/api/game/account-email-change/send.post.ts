import { getHeader } from 'h3'
import {
  getSmtpTransportSettings,
  issueGameEmailChangeCode,
  requireGameApiKey,
  requireGameSession,
  revokeGameEmailChangeCode,
} from '../../../utils/db'
import { sendEmailChangeVerificationEmail } from '../../../utils/smtp'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const token = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw createError({ statusCode: 401, message: '缺少游戏会话' })

  const account = requireGameSession(token)
  const body = await readBody<any>(event)
  const smtp = getSmtpTransportSettings()
  const issued = issueGameEmailChangeCode(
    account,
    body?.password ?? body?.current_password ?? body?.currentPassword,
    body?.email,
  )
  try {
    await sendEmailChangeVerificationEmail(
      smtp,
      issued.email,
      issued.username,
      issued.code,
    )
  } catch {
    revokeGameEmailChangeCode(issued.sessionId, issued.email, issued.code)
    throw createError({ statusCode: 502, message: '换绑邮箱验证码邮件发送失败，请稍后重试' })
  }
  return {
    ok: true,
    msg: '验证码已发送至新邮箱',
    session_id: issued.sessionId,
    expires_in: issued.expiresInSeconds,
    resend_after: issued.resendAfterSeconds,
  }
})
