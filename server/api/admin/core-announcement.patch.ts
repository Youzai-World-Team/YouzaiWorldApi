import { requirePagePermission, setCoreAnnouncement } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requirePagePermission(event, 'core-announcement', 'edit')
  return setCoreAnnouncement(await readBody<unknown>(event))
})
