import { getStatusHistoryStats, requirePagePermission } from '../../utils/db'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  requirePagePermission(event, 'settings', 'view')
  return getStatusHistoryStats()
})
