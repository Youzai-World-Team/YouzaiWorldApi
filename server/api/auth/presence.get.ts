import { listOnlineAdminPresence, requireAuth } from '../../utils/db'

export default defineEventHandler((event) => {
  const user = requireAuth(event)
  return listOnlineAdminPresence().map((presence) => ({
    ...presence,
    isCurrent: presence.id === user.id,
  }))
})
