import { createError } from 'h3'
import { gameAccountWire, getGameAccount, hashGamePassword, requireAuth, upsertGameAccount } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const body = await readBody<any>(event)
  const username = String(body?.username || '').trim()
  const password = String(body?.password || '')
  const uuid = String(body?.uuid || '').trim()
  if (!/^[A-Za-z0-9_]{1,16}$/.test(username) || password.length < 4 || password.length > 128) {
    throw createError({ statusCode: 400, statusMessage: '玩家代号或密码不符合要求' })
  }
  if (uuid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    throw createError({ statusCode: 400, statusMessage: 'UUID 格式不正确' })
  }
  const current = getGameAccount(username)
  if (current?.password) throw createError({ statusCode: 409, statusMessage: '账户已存在' })
  const now = new Date().toISOString()
  const epoch = '1970-01-01T00:00:00Z'
  const account = {
    username, usernameLower: username.toLocaleLowerCase('en-US'), uuid: uuid || current?.uuid || null,
    password: hashGamePassword(password), lastIp: '', lastAuthenticatedDate: epoch, registrationDate: now,
    loginTries: 0, lastKickedDate: epoch, lastPosition: current?.lastPosition ?? null,
    inPlaceRespawnCount: current?.inPlaceRespawnCount ?? 0,
  }
  upsertGameAccount(account)
  return gameAccountWire(account)
})
