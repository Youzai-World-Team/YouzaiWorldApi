import { deleteGameSessionsForUser, gameAccountWire, getGameAccount, getGameAccountSettings, hashGamePassword, refreshGameSession, requireGameApiKey, upsertGameAccount } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const username = String(body?.username || '').trim()
  const current = getGameAccount(username)
  if (!current) throw createError({ statusCode: 404, statusMessage: '账户不存在' })
  const next = { ...current }
  const textFields: Record<string, string> = {
    uuid: 'uuid',
    lastPosition: 'last_position',
    lastIp: 'last_ip',
    lastAuthenticatedDate: 'last_authenticated_date',
  }
  for (const [target, source] of Object.entries(textFields)) {
    const value = body?.[target] !== undefined ? body[target] : body?.[source]
    if (value !== undefined) (next as any)[target] = value == null ? null : String(value)
  }
  const numberFields: Record<string, string> = { inPlaceRespawnCount: 'in_place_respawn_count' }
  for (const [target, source] of Object.entries(numberFields)) {
    const value = body?.[target] !== undefined ? body[target] : body?.[source]
    if (value !== undefined) (next as any)[target] = Math.max(0, Number(value) || 0)
  }
  if (body?.password !== undefined) {
    const password = String(body.password)
    if (password.length < 4 || password.length > 128) throw createError({ statusCode: 400, statusMessage: '密码长度不符合要求' })
    if (!current.password) next.registrationDate = new Date().toISOString()
    next.password = hashGamePassword(password)
    next.lastIp = ''
    next.lastAuthenticatedDate = '1970-01-01T00:00:00Z'
    deleteGameSessionsForUser(username)
  }
  if (body?.unlock === true) {
    if (current.loginTries < 5) {
      throw createError({ statusCode: 409, statusMessage: '账户未被锁定', data: { loginTries: current.loginTries } })
    }
    next.loginTries = 0
    next.lastKickedDate = '1970-01-01T00:00:00Z'
  }
  upsertGameAccount(next)
  if (body?.resume_session === true && body?.password === undefined) {
    const authenticatedAt = Date.parse(next.lastAuthenticatedDate)
    const { sessionTimeout } = getGameAccountSettings()
    if (sessionTimeout > 0 && next.lastIp && Number.isFinite(authenticatedAt) && authenticatedAt > 1000) {
      refreshGameSession(next.username, Date.now() + sessionTimeout * 1000)
    } else {
      deleteGameSessionsForUser(next.username)
    }
  }
  return { ok: true, account: gameAccountWire(next) }
})
