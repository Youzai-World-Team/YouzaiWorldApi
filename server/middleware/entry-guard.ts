import { getAdminEntry, getAuthenticatedUser, isAdminInitialized } from '../utils/db'
import { adminPageKeyForPath, firstVisibleAdminRoute } from '../../shared/admin-page-permissions'

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  if (
    path.startsWith('/api/') ||
    path.startsWith('/_nuxt/') ||
    path.startsWith('/__nuxt_error') ||
    /\.[a-zA-Z0-9]+$/.test(path)
  ) {
    return
  }

  if (!isAdminInitialized()) {
    if (path === '/') return
    return sendRedirect(event, '/', 302)
  }

  const entry = getAdminEntry()

  const user = getAuthenticatedUser(event)

  if (user) {
    if (path === '/' + entry || path === '/login') {
      return sendRedirect(event, '/', 302)
    }
    const pageKey = adminPageKeyForPath(path)
    if (pageKey && user.permissions[pageKey] === 'hidden') {
      return sendRedirect(event, firstVisibleAdminRoute(user.permissions), 302)
    }
    return
  }

  if (path !== '/' + entry) {
    setResponseStatus(event, 404, '页面不存在')
    setResponseHeader(event, 'Content-Type', 'application/json')
    return send(
      event,
      JSON.stringify({
        error: true,
        url: path,
        statusCode: 404,
        statusMessage: '页面不存在',
        message: '页面不存在',
        data: null
      })
    )
  }
})
