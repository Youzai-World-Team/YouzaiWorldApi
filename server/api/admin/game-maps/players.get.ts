import { readGameMapPlayers, requirePagePermission } from '../../../utils/db'
import { gameMapId } from '../../../utils/game-map-input'

export default defineEventHandler((event) => {
  requirePagePermission(event, 'game-maps', 'view')
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const query = getQuery(event)
  return readGameMapPlayers(gameMapId(query.world), gameMapId(query.data_id))
})
