import { requireAuth } from '../../../utils/db'
import { fetchMojangTexture, isMojangLookupDisabled, TEXTURE_HASH_RE } from '../../../utils/mojang'

/**
 * 代理官方材质。页面 CSP 只允许 img-src 'self'，正版皮肤必须由本服务端取回再下发；
 * 入参只有材质哈希，URL 由服务端自己拼接，不存在被引导去请求任意主机的可能。
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  if (isMojangLookupDisabled()) {
    throw createError({ statusCode: 503, message: '本实例已关闭 Mojang 查询（YZWC_MOJANG_DISABLED=1）' })
  }

  const hash = String(getQuery(event).hash || '').trim().toLowerCase()
  if (!TEXTURE_HASH_RE.test(hash)) throw createError({ statusCode: 400, message: '材质哈希格式不正确' })

  const data = await fetchMojangTexture(hash)
  if (!data) throw createError({ statusCode: 502, message: '无法从 Mojang 材质服务器获取图片' })
  setResponseHeader(event, 'Content-Type', 'image/png')
  setResponseHeader(event, 'Content-Disposition', 'inline')
  setResponseHeader(event, 'ETag', `"${hash}"`)
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  return data
})
