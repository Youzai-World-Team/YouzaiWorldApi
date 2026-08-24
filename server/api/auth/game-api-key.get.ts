import { getGameApiKey, requireFeaturePermission } from '../../utils/db'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  requireFeaturePermission(event, 'settings-game-api-key', 'view')
  return { gameApiKey: getGameApiKey() }
})
