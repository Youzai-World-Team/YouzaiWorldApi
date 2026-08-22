import { getAdminGameAccountSettings, requireAuth } from '../../utils/db'

export default defineEventHandler((event) => {
  requireAuth(event)
  return getAdminGameAccountSettings()
})
