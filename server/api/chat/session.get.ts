import { requireChatPlayerSession } from '../../utils/db'

export default defineEventHandler((event) => {
  const token = (getHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
  return { username: requireChatPlayerSession(token) }
})
