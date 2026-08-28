import type { H3Event } from 'h3'
import { getAdminEntry, getAuthenticatedUser, isAdminInitialized } from '../utils/db'
import { adminPageKeyForPath, firstVisibleAdminRoute } from '#shared/admin-page-permissions'

function sendPageNotFound(event: H3Event, path: string) {
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
      data: null,
    }),
  )
}

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  const normalizedPath = path.length > 1 ? path.replace(/\/+$/, '') : path

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
    if (normalizedPath === '/' + entry || normalizedPath === '/login') {
      return sendRedirect(event, '/', 302)
    }
    const pageKey = adminPageKeyForPath(normalizedPath)
    if (!pageKey) {
      if (normalizedPath === '/account') return
      return sendPageNotFound(event, path)
    }
    if (user.permissions[pageKey] === 'hidden') {
      return sendRedirect(event, firstVisibleAdminRoute(user.permissions), 302)
    }
    return
  }

  if (normalizedPath !== '/' + entry) return sendPageNotFound(event, path)
})
