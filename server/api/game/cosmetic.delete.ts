import { deleteGameCosmetics, requireGameApiKey } from '../../utils/db'

export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const uuid = String(getQuery(event).uuid || '').trim()
  if (!uuid) throw createError({ statusCode: 400, statusMessage: '缺少 UUID' })
  deleteGameCosmetics(uuid)
  return { ok: true }
})
