import { getAdminEntry, requireAuth } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireAuth(event, { allowExpired: true })
  return { entry: getAdminEntry() }
})
