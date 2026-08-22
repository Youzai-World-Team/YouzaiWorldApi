import { requireAuth, setAdminGameAccountSettings } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const body = await readBody<any>(event)
  return setAdminGameAccountSettings(body || {})
})
