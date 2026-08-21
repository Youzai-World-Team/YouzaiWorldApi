import { createGameSession, gameAccountWire, getGameAccount, getGameAccountSettings, requireGameApiKey, upsertGameAccount, verifyGamePassword } from '../../utils/db'
import { requireGameUsername } from '../../utils/game-input'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const username = requireGameUsername(body?.username)
  const account = getGameAccount(username)
  if (!account?.password) {
    throw createError({ statusCode: 401, statusMessage: '账户未注册', data: { reason: 'not_registered' } })
  }
  const { loginCooldown } = getGameAccountSettings()
  if (loginCooldown !== -1 && account.loginTries >= 5) {
    if (loginCooldown === 0) {
      throw createError({ statusCode: 423, statusMessage: '账户已永久锁定', data: { loginTries: account.loginTries, retryAfterSeconds: 0 } })
    }
    const kickedAt = Date.parse(account.lastKickedDate)
    const elapsedSeconds = Number.isFinite(kickedAt) ? Math.max(0, Math.floor((Date.now() - kickedAt) / 1000)) : loginCooldown
    if (elapsedSeconds < loginCooldown) {
      throw createError({ statusCode: 423, statusMessage: '账户处于登录冷却', data: { loginTries: account.loginTries, retryAfterSeconds: loginCooldown - elapsedSeconds } })
    }
    account.loginTries = 0
  }
  if (!verifyGamePassword(String(body?.password || ''), account.password)) {
    account.loginTries += 1
    if (account.loginTries >= 5) account.lastKickedDate = new Date().toISOString()
    upsertGameAccount(account)
    throw createError({
      statusCode: 401,
      statusMessage: '密码错误',
      data: {
        reason: 'wrong_password',
        loginTries: account.loginTries,
        remainingTries: Math.max(0, 5 - account.loginTries),
      },
    })
  }
  account.loginTries = 0
  account.lastIp = String(body?.ip || '').slice(0, 64)
  account.lastAuthenticatedDate = new Date().toISOString()
  upsertGameAccount(account)
  return { token: createGameSession(account.username), account: gameAccountWire(account) }
})
