export default defineEventHandler(async (event) => {
  const path = event.path

  if (
    path.startsWith('/api/') ||
    path.startsWith('/_nuxt/') ||
    path.startsWith('/__nuxt_error') ||
    /\.[a-zA-Z0-9]+$/.test(path)
  ) {
    return
  }

  const entry = getSetting('entry') || '123456'

  const token = getCookie(event, 'youzai_token')
  const authed = !!token && hasSession(token)

  if (authed) {
    if (path === '/' + entry || path === '/login') {
      return sendRedirect(event, '/', 302)
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
