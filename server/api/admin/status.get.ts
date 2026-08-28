import { requirePagePermission } from '../../utils/db'
import { getStatusSnapshot } from '../../utils/status'

export default defineEventHandler(async (event) => {
  requirePagePermission(event, 'status', 'view')
  return getStatusSnapshot()
})
