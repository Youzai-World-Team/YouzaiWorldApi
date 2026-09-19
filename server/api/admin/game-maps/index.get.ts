import { listGameMapWorlds, requirePagePermission } from '../../../utils/db'

export default defineEventHandler((event) => {
  requirePagePermission(event, 'game-maps', 'view')
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return { worlds: listGameMapWorlds() }
})
