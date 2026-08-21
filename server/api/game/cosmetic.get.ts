import { getGameCosmetic, listGameCosmeticSlots, requireGameApiKey } from '../../utils/db'
import { UUID_RE } from '../../utils/game-input'

export default defineEventHandler((event) => {
  requireGameApiKey(event)
const uuid = String(getQuery(event).uuid || '').trim()
  const slot = String(getQuery(event).slot || '').trim()
  if (!UUID_RE.test(uuid)) throw createError({ statusCode: 400, statusMessage: 'UUID 格式不正确' })
  if (slot && !['skin.png', 'skin_slim.png', 'cloak.png'].includes(slot)) {
    throw createError({ statusCode: 400, statusMessage: '外观槽位不正确' })
  }
  if (!slot) return { slots: listGameCosmeticSlots(uuid) }
  const item = getGameCosmetic(uuid, slot)
  if (!item) throw createError({ statusCode: 404, statusMessage: '外观不存在' })
  setHeader(event, 'content-type', 'image/png')
  setHeader(event, 'etag', item.sha256)
  return item.data
})
