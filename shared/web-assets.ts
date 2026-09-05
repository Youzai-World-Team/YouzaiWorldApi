/** Cloudflare Pages 上集中托管的官网与后台共享静态资源。 */
export const WEB_ASSET_BASE_URL = 'https://assets.mcyzw.top'

export function webAssetUrl(path: string): string {
  const value = String(path || '').trim()
  if (!value) return WEB_ASSET_BASE_URL
  if (/^(?:https?:|data:|blob:)/i.test(value)) return value
  return `${WEB_ASSET_BASE_URL}/${value.replace(/^\/+/, '')}`
}
