import { getAuthenticatedUser, requireOwner, requirePagePermission } from '../utils/db'
import { isReadOperation, pageKeyForApi } from '#shared/admin-api-permissions'

const PUBLIC_READ_PATHS = new Set([
  '/api/activities',
  '/api/bans',
  '/api/donors',
  '/api/downloads',
])

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  const pageKey = pageKeyForApi(path)
  if (!pageKey) {
    // 实例列表由接口自身按「服务器管理」或「服务器文件」任一页面权限判定。
    if (path.replace(/\/+$/, '') === '/api/admin/mcsm/instances') return
    // 统计同步由接口自己的细分权限判定；游戏统计页面本身是只读页。
    if (path.replace(/\/+$/, '') === '/api/admin/game-stats/sync') return
    // 新增管理接口即使忘记登记页面权限，也只会向初始所有者开放。
    if (path.startsWith('/api/admin/')) requireOwner(event)
    return
  }

  if (pageKey === 'admin-users') {
    requireOwner(event)
    return
  }

  const method = event.method.toUpperCase()
  const readOperation = isReadOperation(path, method)
  // 官网公开数据允许匿名读取；登录后的后台访问仍按对应页面权限判定。
  if (readOperation && PUBLIC_READ_PATHS.has(path) && !getAuthenticatedUser(event)) return
  requirePagePermission(event, pageKey, readOperation ? 'view' : 'edit')
})
