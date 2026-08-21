import { gameAccountWire, getGameAccount, requireGameApiKey } from '../../utils/db'

export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const username = String(getQuery(event).username || '').trim()
  if (!username) throw createError({ statusCode: 400, statusMessage: '缺少玩家代号' })
  const account = getGameAccount(username)
  if (!account) throw createError({ statusCode: 404, statusMessage: '账户不存在' })
  return gameAccountWire(account)
})
