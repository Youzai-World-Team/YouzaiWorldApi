import { deleteGameSessionsForUser, gameAccountWire, getGameAccount, requireGameApiKey, upsertGameAccount } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<{ username?: string; lastPosition?: string | null }>(event)
  const username = String(body?.username || '').trim()
  const account = getGameAccount(username)
  if (!account) throw createError({ statusCode: 404, statusMessage: '账户不存在' })
  const epoch = '1970-01-01T00:00:00Z'
  account.lastIp = ''
  account.lastAuthenticatedDate = epoch
  if (body?.lastPosition !== undefined) account.lastPosition = body.lastPosition || null
  deleteGameSessionsForUser(username)
  upsertGameAccount(account)
  return { ok: true, account: gameAccountWire(account) }
})
