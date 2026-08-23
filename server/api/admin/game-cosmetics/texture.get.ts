import { getGameCosmetic, requireAuth } from '../../../utils/db'
import { UUID_RE } from '../../../utils/game-input'

const SLOTS = new Set(['skin.png', 'skin_slim.png', 'cloak.png'])

/** 后台预览用：按 UUID + 槽位输出本地上传的外观 PNG 原图。 */
export default defineEventHandler((event) => {
  requireAuth(event)
  const uuid = String(getQuery(event).uuid || '').trim().toLowerCase()
  const slot = String(getQuery(event).slot || '').trim()
  if (!UUID_RE.test(uuid)) throw createError({ statusCode: 400, message: 'UUID 格式不正确' })
  if (!SLOTS.has(slot)) throw createError({ statusCode: 400, message: '外观槽位不正确' })

  const item = getGameCosmetic(uuid, slot)
  if (!item) throw createError({ statusCode: 404, message: '外观不存在' })
  setResponseHeader(event, 'Content-Type', 'image/png')
  setResponseHeader(event, 'Content-Disposition', 'inline')
  setResponseHeader(event, 'ETag', `"${item.sha256}"`)
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  return item.data
})
