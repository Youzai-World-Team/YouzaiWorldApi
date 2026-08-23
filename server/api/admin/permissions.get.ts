import { ADMIN_PAGE_DEFINITIONS } from '#shared/admin-page-permissions'
import { listAdminUsers, requirePagePermission } from '../../utils/db'

export default defineEventHandler((event) => {
  requirePagePermission(event, 'permissions', 'view')
  return {
    pages: ADMIN_PAGE_DEFINITIONS,
    users: listAdminUsers(),
  }
})
