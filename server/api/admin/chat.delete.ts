import { clearChatMessages, recordAudit, requireFeaturePermission } from '../../utils/db'

export default defineEventHandler((event) => {
  const user = requireFeaturePermission(event, 'chat-moderate', 'edit')
  const removed = clearChatMessages()
  recordAudit(event, user, `清空聊天区（${removed} 条）`)
  return { ok: true, removed }
})
