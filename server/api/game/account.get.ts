import { gameAccountWire, getGameAccount, requireGameApiKey } from '../../utils/db'
import { requireGameUsername } from '../../utils/game-input'

export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const username = requireGameUsername(getQuery(event).username)
  const account = getGameAccount(username)
  if (!account) throw createError({ statusCode: 404, statusMessage: '账户不存在' })
  return gameAccountWire(account)
})
