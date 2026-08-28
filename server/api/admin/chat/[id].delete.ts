import { deleteChatMessage, recordAudit, requireFeaturePermission } from '../../../utils/db'

export default defineEventHandler((event) => {
  const user = requireFeaturePermission(event, 'chat-moderate', 'edit')

  const id = getRouterParam(event, 'id') || ''
  if (!deleteChatMessage(id)) {
    throw createError({ statusCode: 404, statusMessage: '消息不存在' })
  }

  recordAudit(event, user, '删除聊天消息')
  return { ok: true }
})
