import { deleteGameCosmetics, requireGameApiKey } from '../../utils/db'
import { UUID_RE } from '../../utils/game-input'

export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const uuid = String(getQuery(event).uuid || '').trim()
  if (!UUID_RE.test(uuid)) throw createError({ statusCode: 400, statusMessage: 'UUID 格式不正确' })
  deleteGameCosmetics(uuid)
  return { ok: true }
})
