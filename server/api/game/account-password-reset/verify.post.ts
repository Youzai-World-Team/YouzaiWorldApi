import { completeGamePasswordReset, requireGameApiKey } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  completeGamePasswordReset(
    body?.session_id ?? body?.sessionId,
    body?.code ?? body?.verification_code,
    body?.new_password ?? body?.newPassword,
  )
  return { ok: true, msg: '密码已重置' }
})
