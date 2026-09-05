import { ADMIN_FEATURE_DEFINITIONS, ADMIN_PAGE_DEFINITIONS } from '#shared/admin-page-permissions'
import { listAdminUsers, listDomainMailAccessUsers, requirePagePermission } from '../../utils/db'

export default defineEventHandler((event) => {
  const actor = requirePagePermission(event, 'permissions', 'view')
  const domainMailByUser = actor.isOwner
    ? new Map(listDomainMailAccessUsers().map((item) => [item.id, item]))
    : new Map()
  return {
    pages: ADMIN_PAGE_DEFINITIONS,
    features: ADMIN_FEATURE_DEFINITIONS,
    users: listAdminUsers().map((user) => ({
      ...user,
      domainMail: domainMailByUser.get(user.id) || null,
    })),
  }
})
