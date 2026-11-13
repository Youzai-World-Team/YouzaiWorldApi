import { getCoreAnnouncement, requirePagePermission } from '../../utils/db'

export default defineEventHandler((event) => {
  requirePagePermission(event, 'core-announcement', 'view')
  return getCoreAnnouncement()
})
