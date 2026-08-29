import { createError } from 'h3'
import { gameAccountWire, getGameAccount, hashGamePassword, requireFeaturePermission, requireGamePassword, upsertGameAccount } from '../../utils/db'
import { offlinePlayerUuid, requireGameUsername } from '../../utils/game-input'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'game-accounts-manage', 'edit')
  const body = await readBody<any>(event)
  const username = requireGameUsername(body?.username)
  const password = requireGamePassword(body?.password)
  if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) throw createError({ statusCode: 400, statusMessage: '玩家代号不符合要求' })
  const uuid = offlinePlayerUuid(username)
  const current = getGameAccount(username)
  if (current?.password) throw createError({ statusCode: 409, statusMessage: '账户已存在' })
  const now = new Date().toISOString()
  const epoch = '1970-01-01T00:00:00Z'
  const account = {
    username, usernameLower: username.toLocaleLowerCase('en-US'), uuid,
    email: current?.email ?? null,
    password: hashGamePassword(password), lastIp: '', lastLoginIp: current?.lastLoginIp ?? '',
    lastAuthenticatedDate: epoch, registrationDate: now,
    loginTries: 0, lastKickedDate: epoch, lastPosition: current?.lastPosition ?? null,
    inPlaceRespawnCount: current?.inPlaceRespawnCount ?? 0,
  }
  upsertGameAccount(account)
  return gameAccountWire(account)
})
