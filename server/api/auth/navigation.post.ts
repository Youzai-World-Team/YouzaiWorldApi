import { recordAudit, requireAuth, updateAdminNavigationPreferences } from '../../utils/db'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const actor = requireAuth(event)
  const body = await readBody<{ order?: unknown; hidden?: unknown }>(event)
  const user = updateAdminNavigationPreferences(actor.id, body?.order, body?.hidden)
  recordAudit(event, user, '更新自己的侧边栏偏好')
  return { user }
})
