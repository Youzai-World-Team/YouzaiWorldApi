import { getAdminGameAccountSettings, requirePagePermission } from '../../utils/db'

export default defineEventHandler((event) => {
  requirePagePermission(event, 'game-accounts', 'view')
  return getAdminGameAccountSettings()
})
