import { readGameMapTiles, requirePagePermission } from '../../../utils/db'
import { parseMapViewport } from '../../../utils/game-map-input'

export default defineEventHandler((event) => {
  requirePagePermission(event, 'game-maps', 'view')
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return readGameMapTiles(parseMapViewport(getQuery(event)))
})
