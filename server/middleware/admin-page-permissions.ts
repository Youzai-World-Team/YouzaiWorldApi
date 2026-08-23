import { getAuthenticatedUser, requireOwner, requirePagePermission } from '../utils/db'
import { isReadOperation, pageKeyForApi } from '#shared/admin-api-permissions'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  const pageKey = pageKeyForApi(path)
  if (!pageKey) return

  if (pageKey === 'admin-users') {
    requireOwner(event)
    return
  }

  const method = event.method.toUpperCase()
  const readOperation = isReadOperation(path, method)
  if (readOperation && !getAuthenticatedUser(event)) return
  requirePagePermission(event, pageKey, readOperation ? 'view' : 'edit')
})
