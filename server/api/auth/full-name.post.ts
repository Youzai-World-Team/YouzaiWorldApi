import { recordAudit, requireAuth, updateAdminFullName } from '../../utils/db'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const actor = requireAuth(event)
  const body = await readBody<{ fullName?: string }>(event)
  const user = updateAdminFullName(actor.id, body?.fullName)
  recordAudit(event, user, '修改自己的后台全名')
  return { user }
})
