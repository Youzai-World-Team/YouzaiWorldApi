const TRUSTED_WEB_ORIGINS = new Set(['https://mcyzw.top', 'https://www.mcyzw.top', 'https://api.mcyzw.top'])
const LOCAL_DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const MCSM_UPLOAD_CHUNK_MAX_BYTES = 128 * 1024
const DOMAIN_MAIL_PREVIEW_MAX_BYTES = 4 * 1024 * 1024
const DOMAIN_MAIL_SEND_MAX_BYTES = 18 * 1024 * 1024

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
    'Cache-Control': event.path.startsWith('/api/auth/')
      || event.path.startsWith('/api/admin/')
      || event.path === '/api/deploy'
      ? 'no-store'
      : 'no-cache',
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; connect-src 'self' https://mcyzw.top https://challenges.cloudflare.com; font-src 'self' https://fonts.gstatic.com data:; form-action 'self'; frame-ancestors 'none'; frame-src 'self' https://challenges.cloudflare.com; img-src 'self' data: blob: https://mcyzw.top https://assets.mcyzw.top https://*.mcyzw.top; object-src 'none'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': event.path.startsWith('/api/update/') ? 'cross-origin' : 'same-site',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  })

  const method = event.method.toUpperCase()
  // /api/game/、/api/inbound-mail 与 /api/deploy 由各自的签名/令牌校验把关：调用方是服务器模组、
  // Cloudflare Email Worker 或 GitHub Actions，不带 Origin，也不受这里的 256 KiB 体积上限约束。
  if (!MUTATING_METHODS.has(method)
    || event.path.startsWith('/api/game/')
    || event.path === '/api/inbound-mail'
    || event.path === '/api/deploy') return

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
  // multipart 还包含边界和字段头；实际图片仍由上传接口限制为 2 MiB。
  // 服务器文件上传使用 upload-chunk 分块接口，单块体积由下面的 128 KiB
  // 限制，完整文件上限仍由接口校验。
  const path = event.path.split('?')[0] || event.path
  const maxBytes = path === '/api/upload'
    ? 2 * 1024 * 1024 + 64 * 1024
    : path === '/api/admin/mcsm/files/upload-chunk'
      ? MCSM_UPLOAD_CHUNK_MAX_BYTES
      : path === '/api/admin/domain-mails/send'
        // Includes up to 10 MiB of attachments after Base64 expansion and escaped HTML.
        ? DOMAIN_MAIL_SEND_MAX_BYTES
        : path === '/api/admin/domain-mails/preview'
          // A 512 KiB string can grow to about 3 MiB when JSON escapes control characters.
          ? DOMAIN_MAIL_PREVIEW_MAX_BYTES
        : 256 * 1024
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > maxBytes) {
    throw createError({ statusCode: 413, statusMessage: '请求体过大' })
  }
})
