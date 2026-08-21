import { gameAccountWire, getGameAccount, requireGameApiKey, upsertGameAccount } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const username = String(body?.username || '').trim()
  if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
    throw createError({ statusCode: 400, statusMessage: '玩家代号格式不正确' })
  }
  const usernameLower = username.toLocaleLowerCase('en-US')
  const current = getGameAccount(username)
  if (current) {
    if (!current.uuid && body?.uuid) {
      current.uuid = String(body.uuid)
      upsertGameAccount(current)
    }
    return { ok: true, created: false, account: gameAccountWire(current) }
  }
  const epoch = '1970-01-01T00:00:00Z'
  const account = {
    username,
    usernameLower,
    uuid: body?.uuid ? String(body.uuid) : null,
    password: '',
    lastIp: '',
    lastAuthenticatedDate: epoch,
    registrationDate: epoch,
    loginTries: 0,
    lastKickedDate: epoch,
    lastPosition: null,
    inPlaceRespawnCount: 0,
  }
  upsertGameAccount(account)
  return { ok: true, created: true, account: gameAccountWire(account) }
})
