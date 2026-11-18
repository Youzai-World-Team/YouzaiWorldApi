import { readGameMapOverview, requirePagePermission } from '../../../utils/db'
import { parseMapSelection } from '../../../utils/game-map-input'

export default defineEventHandler(event => {
  requirePagePermission(event, 'game-maps', 'view')
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return readGameMapOverview(parseMapSelection(getQuery(event)))
})
