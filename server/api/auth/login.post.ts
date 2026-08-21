import { randomBytes } from 'node:crypto'
import { deleteCookie, setCookie } from 'h3'
import { assertAdminLoginAllowed, clearAdminLoginFailures, createSession, getAdminEntry,
  pushLogin, recordAdminLoginFailure, verifyAdminPassword, ADMIN_COOKIE_NAME } from '../../utils/db'
import { describeClient } from '../../utils/client-device'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ password?: string; entry?: string }>(event)
  const ip = (getHeader(event, 'cf-connecting-ip') || getRequestIP(event) || 'unknown').slice(0, 64)
  assertAdminLoginAllowed(ip)
  const entry = String(body?.entry || '').trim().replace(/^\/+|\/+$/g, '')
  if (entry !== getAdminEntry()) {
    recordAdminLoginFailure(ip)
    throw createError({ statusCode: 404, statusMessage: '页面不存在' })
  }

  if (!body.password || !verifyAdminPassword(body.password)) {
    recordAdminLoginFailure(ip)
    throw createError({ statusCode: 401, statusMessage: '密码错误' })
  }

  const token = randomBytes(24).toString('hex')
  createSession(token)
  clearAdminLoginFailures(ip)
  const client = describeClient(
    getHeader(event, 'user-agent'),
    getHeader(event, 'sec-ch-ua-platform'),
    getHeader(event, 'sec-ch-ua-mobile'),
  )
  pushLogin(ip, Date.now(), client)
  deleteCookie(event, 'youzai_token', { path: '/', secure: true, sameSite: 'strict' })
  setCookie(event, ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })

  return { ok: true }
})
