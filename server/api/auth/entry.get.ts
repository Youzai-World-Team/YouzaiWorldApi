import { getAdminEntry, requireAuth } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  return { entry: getAdminEntry() }
})
