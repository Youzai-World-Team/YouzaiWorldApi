import { sendRedirect } from 'h3'
import { webAssetUrl } from '#shared/web-assets'

/**
 * 保留旧版头像与书签地址的兼容入口；实际图标由 WebAssets 提供。
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=86400')
  return sendRedirect(event, webAssetUrl('/favicon.ico'), 302)
})
