import { recordAudit } from '../utils/db'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('afterResponse', (event) => {
    const method = String(event.method || '').toUpperCase()
    const path = getRequestURL(event).pathname
    const user = event.context.adminUser
    const status = event.node.res.statusCode
    if (!user || !path.startsWith('/api/')) return
    // game-cosmetics/lookup 是只读的正版档案查询，用 POST 只为在请求体里带玩家名单。
    if (path.startsWith('/api/admin/users') || path.startsWith('/api/admin/permissions') || ['/api/auth/avatar', '/api/auth/full-name', '/api/auth/entry', '/api/auth/password', '/api/auth/logout', '/api/auth/game-api-key', '/api/admin/game-cosmetics/lookup'].includes(path)) return
    if (!['POST', 'PATCH', 'DELETE'].includes(method) || status < 200 || status >= 300) return
    recordAudit(event, user)
  })
})
