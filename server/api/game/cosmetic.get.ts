import { getGameCosmetic, listGameCosmeticSlots, requireGameApiKey } from '../../utils/db'

export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const uuid = String(getQuery(event).uuid || '').trim()
  const slot = String(getQuery(event).slot || '').trim()
  if (!uuid) throw createError({ statusCode: 400, statusMessage: '缺少 UUID' })
  if (!slot) return { slots: listGameCosmeticSlots(uuid) }
  const item = getGameCosmetic(uuid, slot)
  if (!item) throw createError({ statusCode: 404, statusMessage: '外观不存在' })
  setHeader(event, 'content-type', 'image/png')
  setHeader(event, 'etag', item.sha256)
  return item.data
})
