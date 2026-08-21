import { getHeader } from 'h3'
import { deleteGameSession, requireGameApiKey } from '../../utils/db'

export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const token = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  if (token) deleteGameSession(token)
  return { ok: true }
})
