import { deleteCookie } from 'h3'
import { ADMIN_COOKIE_NAME, recordAudit, updateAdminPassword } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)

  const body = await readBody<{ oldPassword?: string; newPassword?: string }>(event)
  if (!body.oldPassword || !body.newPassword) {
    throw createError({ statusCode: 400, statusMessage: '参数不完整' })
  }

  updateAdminPassword(user, body.oldPassword, body.newPassword)
  recordAudit(event, user, '修改自己的后台密码')
  deleteCookie(event, ADMIN_COOKIE_NAME, { path: '/', secure: true, sameSite: 'strict' })
  deleteCookie(event, 'youzai_token', { path: '/', secure: true, sameSite: 'strict' })
  return { ok: true, reloginRequired: true }
})
