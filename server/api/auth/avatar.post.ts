import { recordAudit, requireFeaturePermission, updateAdminAvatar } from '../../utils/db'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const actor = requireFeaturePermission(event, 'account-avatar', 'edit')
  const body = await readBody<{ avatar?: string }>(event)
  const user = updateAdminAvatar(actor.id, body?.avatar)
  recordAudit(event, user, '修改自己的后台头像')
  return { user }
})
