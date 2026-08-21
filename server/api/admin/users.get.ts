import { listAdminUsers, requireOwner } from '../../utils/db'

export default defineEventHandler((event) => {
  requireOwner(event)
  return listAdminUsers()
})
