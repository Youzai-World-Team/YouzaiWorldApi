import { listOnlineAdminPresence, requireAuth, touchAdminPresence } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody<{ path?: unknown }>(event)
  touchAdminPresence(user.id, body?.path)
  return listOnlineAdminPresence().map((presence) => ({
    ...presence,
    isCurrent: presence.id === user.id,
  }))
})
