import { listAdminAccountDevices, requireAuth } from '../../utils/db'
import { resolveIpLocations } from '../../utils/ip-location'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const devices = listAdminAccountDevices(event, user)
  const locations = await resolveIpLocations(devices.map((device) => device.ip), event, 20)
  return devices.map((device) => ({ ...device, location: locations.get(device.ip) || '' }))
})
