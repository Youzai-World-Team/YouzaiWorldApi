import {
  deleteGameSessionsForUser,
  gameAccountWire,
  getGameAccount,
  getGameAccountSettings,
  hashGamePassword,
  requireGameApiKey,
  requireGamePassword,
  upsertGameAccount,
} from '../../utils/db'
import { optionalPosition, optionalUuid, requireGameUsername } from '../../utils/game-input'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const username = requireGameUsername(body?.username)
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
    if (value !== undefined) {
      if (target === 'uuid') (next as any)[target] = optionalUuid(value)
      else if (target === 'lastPosition') (next as any)[target] = optionalPosition(value)
      else if (String(value).length > 256) throw createError({ statusCode: 400, statusMessage: '账户字段过长' })
      else (next as any)[target] = value == null ? null : String(value)
    }
  }
  const numberFields: Record<string, string> = { inPlaceRespawnCount: 'in_place_respawn_count' }
  for (const [target, source] of Object.entries(numberFields)) {
    const value = body?.[target] !== undefined ? body[target] : body?.[source]
    if (value !== undefined) (next as any)[target] = Math.max(0, Number(value) || 0)
  }
  if (body?.password !== undefined) {
    if (!current.password && getGameAccountSettings().emailVerificationRequired) {
      throw createError({ statusCode: 409, message: '启用邮箱验证时请通过注册接口完成注册' })
    }
    const password = requireGamePassword(body.password)
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
  return { ok: true, account: gameAccountWire(next) }
})
