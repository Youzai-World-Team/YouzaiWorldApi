import { randomBytes } from 'node:crypto'
import { deleteCookie, setCookie } from 'h3'
import { assertAdminLoginAllowed, clearAdminLoginFailures, consumeAdminLoginTakeover,
  createAdminLoginTakeover, createSession, getAdminEntry, getAdminLoginSessionState,
  getAdminUserForLogin, pushLogin, recordAdminLoginFailure, recordAudit, ADMIN_COOKIE_NAME,
  type AdminUser } from '../../utils/db'
import { describeClient } from '../../utils/client-device'
import { resolveIpLocation } from '../../utils/ip-location'
import { verifyTurnstileLogin } from '../../utils/turnstile'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    username?: string
    password?: string
    entry?: string
    turnstileToken?: string
    takeoverToken?: string
  }>(event)
  const ip = (getHeader(event, 'cf-connecting-ip') || getRequestIP(event) || 'unknown').slice(0, 64)
  const client = describeClient(
    getHeader(event, 'user-agent'),
    getHeader(event, 'sec-ch-ua-platform'),
    getHeader(event, 'sec-ch-ua-mobile'),
  )
  assertAdminLoginAllowed(ip)
  const entry = String(body?.entry || '').trim().replace(/^\/+|\/+$/g, '')
  if (entry !== getAdminEntry()) {
    recordAdminLoginFailure(ip)
    throw createError({ statusCode: 404, statusMessage: '页面不存在' })
  }

  async function completeLogin(user: AdminUser, auditAction: string) {
    await resolveIpLocation(ip, event)
    const token = randomBytes(24).toString('hex')
    createSession(token, user.id, ip, client)
    clearAdminLoginFailures(ip)
    pushLogin(ip, Date.now(), client, user.username, user.id)
    recordAudit(event, user, auditAction)
    deleteCookie(event, 'youzai_token', { path: '/', secure: true, sameSite: 'strict' })
    setCookie(event, ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })
    return { ok: true }
  }

  if (body.takeoverToken) {
    const user = consumeAdminLoginTakeover(body.takeoverToken, ip, client)
    return completeLogin(user, '挤下在线设备并登录后台')
  }

  await verifyTurnstileLogin(body.turnstileToken, ip)

  const user = body.password ? getAdminUserForLogin(body.username, body.password) : undefined
  if (!user) {
    recordAdminLoginFailure(ip)
    throw createError({ statusCode: 401, statusMessage: '用户名或密码错误' })
  }

  clearAdminLoginFailures(ip)
  const sessionState = getAdminLoginSessionState(user.id)
  if (sessionState.online) {
    const takeover = createAdminLoginTakeover(user.id, ip, client)
    const location = sessionState.latest ? await resolveIpLocation(sessionState.latest.ip, event) : ''
    throw createError({
      statusCode: 409,
      statusMessage: '当前账户已在其他设备在线',
      data: {
        code: 'ADMIN_ACCOUNT_ONLINE',
        takeoverToken: takeover.token,
        expiresAt: takeover.expiresAt,
        sessionCount: sessionState.sessionCount,
        session: sessionState.latest ? { ...sessionState.latest, location: location === '未知' ? '' : location } : null,
      },
    })
  }

  return completeLogin(user, sessionState.hasSession ? '替换离线设备并登录后台' : '登录后台')
})
