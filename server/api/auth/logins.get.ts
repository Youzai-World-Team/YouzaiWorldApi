import { listLogins, requireAuth } from '../../utils/db'
import { resolveIpLocations } from '../../utils/ip-location'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const logins = listLogins()
  const locations = await resolveIpLocations(logins.map((login) => login.ip), event, 20)
  return logins.map((login) => ({ ...login, location: locations.get(login.ip) || '' }))
})
