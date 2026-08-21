import { getGameCosmetic, requireGameApiKey } from '../../utils/db'
import { UUID_RE } from '../../utils/game-input'

const SLOTS = ['skin.png', 'skin_slim.png', 'cloak.png'] as const

export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const uuid = String(getQuery(event).uuid || '').trim()
  if (!UUID_RE.test(uuid)) throw createError({ statusCode: 400, statusMessage: 'UUID 格式不正确' })
  const files: Record<string, string> = {}
  for (const slot of SLOTS) {
    const item = getGameCosmetic(uuid, slot)
    files[slot] = item ? item.data.toString('base64') : ''
  }
  return { uuid, files }
})
