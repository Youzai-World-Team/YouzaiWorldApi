const TRUSTED_WEB_ORIGINS = new Set(['https://mcyzw.top', 'https://www.mcyzw.top', 'https://api.mcyzw.top'])
const LOCAL_DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function isTrustedWebOrigin(origin: string): boolean {
  if (TRUSTED_WEB_ORIGINS.has(origin)) return true
  if (!import.meta.dev) return false

  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && LOCAL_DEVELOPMENT_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

export default defineEventHandler((event) => {
  setResponseHeaders(event, {
    'Cache-Control': event.path.startsWith('/api/auth/') || event.path.startsWith('/api/admin/')
      ? 'no-store'
      : 'no-cache',
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; connect-src 'self' https://mcyzw.top; font-src 'self' https://fonts.gstatic.com data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': event.path.startsWith('/api/update/') ? 'cross-origin' : 'same-site',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  })

  const method = event.method.toUpperCase()
  if (!MUTATING_METHODS.has(method) || event.path.startsWith('/api/game/')) return

  const origin = getHeader(event, 'origin')
  if (origin && !isTrustedWebOrigin(origin)) {
    throw createError({ statusCode: 403, statusMessage: '请求来源不受信任' })
  }

  const fetchSite = getHeader(event, 'sec-fetch-site')
  if (fetchSite === 'cross-site') {
    throw createError({ statusCode: 403, statusMessage: '拒绝跨站请求' })
  }

  const contentLengthHeader = getHeader(event, 'content-length')
  const contentLength = Number(contentLengthHeader || 0)
  const maxBytes = event.path === '/api/upload' ? 2 * 1024 * 1024 : 256 * 1024
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > maxBytes) {
    throw createError({ statusCode: 413, statusMessage: '请求体过大' })
  }
})
