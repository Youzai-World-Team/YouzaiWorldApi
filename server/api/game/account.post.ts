import { createGameSession, gameAccountWire, getGameAccount, hashGamePassword, requireGameApiKey, upsertGameAccount } from '../../utils/db'
import { offlinePlayerUuid, optionalPosition, optionalUuid, requireGameUsername } from '../../utils/game-input'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const username = requireGameUsername(body?.username)
  const usernameLower = username.toLocaleLowerCase('en-US')
  const password = String(body?.password || '')
  const uuid = optionalUuid(body?.uuid)
  if (password.length < 4 || password.length > 128) throw createError({ statusCode: 400, statusMessage: '密码长度需要为 4 至 128 位' })
  const current = getGameAccount(username)
  if (current?.password) throw createError({ statusCode: 409, statusMessage: '账户已注册' })
  const lastPosition = body?.last_position == null ? null : optionalPosition(body.last_position)
  const now = new Date().toISOString()
  const epoch = '1970-01-01T00:00:00Z'
  const startSession = body?.start_session === true
  const loginIp = startSession ? String(body?.last_ip ?? '').slice(0, 64) : ''
  const account = {
    username, usernameLower, uuid: uuid ?? current?.uuid ?? offlinePlayerUuid(username),
    password: hashGamePassword(password),
    lastIp: startSession ? loginIp : String(current?.lastIp ?? ''),
    lastLoginIp: startSession ? loginIp : String(current?.lastLoginIp ?? current?.lastIp ?? ''),
    lastAuthenticatedDate: startSession ? now : String(current?.lastAuthenticatedDate ?? epoch),
    registrationDate: String(body?.registration_date ?? now),
    loginTries: Math.max(0, Number(body?.login_tries ?? 0) || 0),
    lastKickedDate: String(body?.last_kicked_date ?? '1970-01-01T00:00:00Z'),
    lastPosition,
    inPlaceRespawnCount: Math.max(0, Number(body?.in_place_respawn_count ?? current?.inPlaceRespawnCount ?? 0) || 0),
  }
  upsertGameAccount(account)
  if (!startSession) return { ok: true, token: null, account: gameAccountWire(account) }
  return { ok: true, token: createGameSession(account.username), account: gameAccountWire(account) }
})
