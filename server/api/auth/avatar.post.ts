import { recordAudit, requireAuth, updateAdminAvatar } from '../../utils/db'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const actor = requireAuth(event)
  const body = await readBody<{ avatar?: string }>(event)
  const user = updateAdminAvatar(actor.id, body?.avatar)
  recordAudit(event, user, '修改自己的后台头像')
  return { user }
})
