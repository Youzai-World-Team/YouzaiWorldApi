import { ADMIN_FEATURE_DEFINITIONS, ADMIN_PAGE_DEFINITIONS } from '#shared/admin-page-permissions'
import { listAdminUsers, requirePagePermission } from '../../utils/db'

export default defineEventHandler((event) => {
  requirePagePermission(event, 'permissions', 'view')
  return {
    pages: ADMIN_PAGE_DEFINITIONS,
    features: ADMIN_FEATURE_DEFINITIONS,
    users: listAdminUsers(),
  }
})
