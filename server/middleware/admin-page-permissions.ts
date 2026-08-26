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
  // 官网下载页需要匿名读取项目列表；新增、修改和删除仍受下载项目页面权限保护。
  if (path === '/api/downloads' && readOperation) return
  if (readOperation && !getAuthenticatedUser(event)) return
  requirePagePermission(event, pageKey, readOperation ? 'view' : 'edit')
})
