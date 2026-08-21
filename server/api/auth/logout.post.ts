import { deleteCookie } from 'h3'
import { ADMIN_COOKIE_NAME } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const cookie = getCookie(event, ADMIN_COOKIE_NAME)
  const header = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  const token = cookie || header

  if (token) {
    deleteSession(token)
  }
  deleteCookie(event, ADMIN_COOKIE_NAME, { path: '/', secure: true, sameSite: 'strict' })
  deleteCookie(event, 'youzai_token', { path: '/', secure: true, sameSite: 'strict' })

  return { ok: true }
})
