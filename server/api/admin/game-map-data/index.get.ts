import { getGameMapIndex, requireFeaturePermission } from '../../../utils/db'

export default defineEventHandler(event => {
  requireFeaturePermission(event, 'settings-game-maps', 'edit')
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return getGameMapIndex()
})
