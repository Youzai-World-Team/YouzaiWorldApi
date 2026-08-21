import { requireGameApiKey, upsertGameCosmetic } from '../../utils/db'

const SLOTS = new Set(['skin.png', 'skin_slim.png', 'cloak.png'])
const MAX_BYTES = 512 * 1024

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const uuid = String(getQuery(event).uuid || '').trim()
  const slot = String(getQuery(event).slot || '').trim()
  if (!uuid || !SLOTS.has(slot)) throw createError({ statusCode: 400, statusMessage: '外观参数不正确' })
  const raw = await readRawBody(event)
  const data = raw == null ? Buffer.alloc(0) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
  if (!data.length || data.length > MAX_BYTES) throw createError({ statusCode: 400, statusMessage: '外观文件大小不正确' })
  const result = upsertGameCosmetic(uuid, slot, data)
  return { ok: true, ...result }
})
