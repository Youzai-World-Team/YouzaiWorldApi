const TEMPLATE_LOGO_URL = 'https://assets.mcyzw.top/images/uzw-tm.png'
const TEMPLATE_LOGO_MAX_BYTES = 1024 * 1024
let cachedLogo: Buffer | null = null
let pendingLogo: Promise<Buffer> | null = null

async function loadTemplateLogo(): Promise<Buffer> {
  if (cachedLogo) return cachedLogo
  if (!pendingLogo) {
    pendingLogo = (async () => {
      const response = await fetch(TEMPLATE_LOGO_URL, {
        headers: { Accept: 'image/png' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok || !String(response.headers.get('content-type') || '').toLowerCase().startsWith('image/png')) {
        throw new Error(`Logo 资源响应异常：${response.status}`)
      }
      const declaredLength = Number(response.headers.get('content-length') || 0)
      if (declaredLength > TEMPLATE_LOGO_MAX_BYTES) throw new Error('Logo 资源过大')
      const content = Buffer.from(await response.arrayBuffer())
      if (!content.length || content.length > TEMPLATE_LOGO_MAX_BYTES) throw new Error('Logo 资源为空或过大')
      cachedLogo = content
      return content
    })().finally(() => {
      pendingLogo = null
    })
  }
  return pendingLogo!
}

export default defineEventHandler(async (event) => {
  let content: Buffer
  try {
    content = await loadTemplateLogo()
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Logo 加载失败'
    throw createError({ statusCode: 502, statusMessage: detail })
  }

  setResponseHeaders(event, {
    'Content-Type': 'image/png',
    'Content-Length': String(content.length),
    'Cache-Control': 'public, max-age=86400',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Access-Control-Allow-Origin': '*',
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Type-Options': 'nosniff',
  })
  return content
})
