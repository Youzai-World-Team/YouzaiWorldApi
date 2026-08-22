import { getGameApiKey, requireAuth } from '../../utils/db'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  requireAuth(event)
  return { gameApiKey: getGameApiKey() }
})
