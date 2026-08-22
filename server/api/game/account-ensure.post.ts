import { gameAccountWire, getGameAccount, requireGameApiKey, upsertGameAccount } from '../../utils/db'
import { offlinePlayerUuid, optionalUuid, requireGameUsername } from '../../utils/game-input'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const username = requireGameUsername(body?.username)
  const uuid = optionalUuid(body?.uuid) ?? offlinePlayerUuid(username)
  const usernameLower = username.toLocaleLowerCase('en-US')
  const current = getGameAccount(username)
  if (current) {
    if (!current.uuid && uuid) {
      current.uuid = uuid
      upsertGameAccount(current)
    }
    return { ok: true, created: false, account: gameAccountWire(current) }
  }
  const epoch = '1970-01-01T00:00:00Z'
  const account = {
    username,
    usernameLower,
    uuid,
    email: current?.email ?? null,
    password: '',
    lastIp: '',
    lastLoginIp: '',
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
