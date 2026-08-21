import { getHeader } from 'h3'
import { gameAccountWire, requireGameApiKey, requireGameSession } from '../../utils/db'

export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const token = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw createError({ statusCode: 401, statusMessage: '缺少游戏会话' })
  return gameAccountWire(requireGameSession(token))
})
