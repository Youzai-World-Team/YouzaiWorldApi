import { requirePagePermission, setAdminGameAccountSettings } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requirePagePermission(event, 'game-accounts', 'edit')
  const body = await readBody<any>(event)
  return setAdminGameAccountSettings(body || {})
})
