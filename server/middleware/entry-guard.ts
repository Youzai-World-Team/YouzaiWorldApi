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

  const config = await readJson<{ entry?: string }>('config.json', { entry: '123456' })
  const entry = config.entry || '123456'

  const token = getCookie(event, 'youzai_token')
  const sessions = await readJson<Record<string, number>>('sessions.json', {})
  const authed = !!token && !!sessions[token]

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
