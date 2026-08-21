import { createGameSession, gameAccountWire, getGameAccount, hashGamePassword, requireGameApiKey, upsertGameAccount } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const username = String(body?.username || '').trim()
  const usernameLower = username.toLocaleLowerCase('en-US')
  const password = String(body?.password || '')
  if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) throw createError({ statusCode: 400, statusMessage: '玩家代号格式不正确' })
  if (password.length < 4 || password.length > 128) throw createError({ statusCode: 400, statusMessage: '密码长度需要为 4 至 128 位' })
  const current = getGameAccount(username)
  if (current?.password) throw createError({ statusCode: 409, statusMessage: '账户已注册' })
  const now = new Date().toISOString()
  const epoch = '1970-01-01T00:00:00Z'
  const startSession = body?.start_session === true
  const account = {
    username, usernameLower, uuid: body?.uuid ? String(body.uuid) : current?.uuid ?? null,
    password: hashGamePassword(password),
    lastIp: startSession ? String(body?.last_ip ?? '') : String(current?.lastIp ?? ''),
    lastAuthenticatedDate: startSession ? now : String(current?.lastAuthenticatedDate ?? epoch),
    registrationDate: String(body?.registration_date ?? now),
    loginTries: Math.max(0, Number(body?.login_tries ?? 0) || 0),
    lastKickedDate: String(body?.last_kicked_date ?? '1970-01-01T00:00:00Z'),
    lastPosition: body?.last_position == null ? current?.lastPosition ?? null : String(body.last_position),
    inPlaceRespawnCount: Math.max(0, Number(body?.in_place_respawn_count ?? current?.inPlaceRespawnCount ?? 0) || 0),
  }
  upsertGameAccount(account)
  if (!startSession) return { ok: true, token: null, account: gameAccountWire(account) }
  return { ok: true, token: createGameSession(account.username), account: gameAccountWire(account) }
})
