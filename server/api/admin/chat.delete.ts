import { clearChatMessages, recordAudit, requireAuth } from '../../utils/db'

export default defineEventHandler((event) => {
  const user = requireAuth(event)
  const removed = clearChatMessages()
  recordAudit(event, user, `清空聊天区（${removed} 条）`)
  return { ok: true, removed }
})
