import { deleteCookie } from 'h3'
import { ADMIN_COOKIE_NAME, updateAdminPassword } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const body = await readBody<{ oldPassword?: string; newPassword?: string }>(event)
  if (!body.oldPassword || !body.newPassword) {
    throw createError({ statusCode: 400, statusMessage: '参数不完整' })
  }

  updateAdminPassword(body.oldPassword, body.newPassword)
  deleteCookie(event, ADMIN_COOKIE_NAME, { path: '/', secure: true, sameSite: 'strict' })
  deleteCookie(event, 'youzai_token', { path: '/', secure: true, sameSite: 'strict' })
  return { ok: true, reloginRequired: true }
})
