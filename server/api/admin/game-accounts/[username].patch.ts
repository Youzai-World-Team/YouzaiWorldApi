import { createError } from 'h3'
import { deleteGameSessionsForUser, gameAccountWire, getGameAccount, hashGamePassword, requireAuth, upsertGameAccount } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const username = String(getRouterParam(event, 'username') || '').trim()
  const account = getGameAccount(username)
  if (!account) throw createError({ statusCode: 404, statusMessage: '账户不存在' })
  const body = await readBody<any>(event)
  if (body?.password !== undefined) {
    const password = String(body.password)
    if (password.length < 4 || password.length > 128) throw createError({ statusCode: 400, statusMessage: '密码长度需要为 4 至 128 位' })
    if (!account.password) account.registrationDate = new Date().toISOString()
    account.password = hashGamePassword(password)
    account.lastIp = ''
    account.lastAuthenticatedDate = '1970-01-01T00:00:00Z'
    deleteGameSessionsForUser(username)
  }
  if (body?.uuid !== undefined) {
    const uuid = String(body.uuid || '').trim()
    if (uuid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
      throw createError({ statusCode: 400, statusMessage: 'UUID 格式不正确' })
    }
    account.uuid = uuid || null
  }
  if (body?.unlock === true) {
    account.loginTries = 0
    account.lastKickedDate = '1970-01-01T00:00:00Z'
  }
  upsertGameAccount(account)
  return gameAccountWire(account)
})
