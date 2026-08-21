import { getGameAccountSettings, requireAuth } from '../../utils/db'

export default defineEventHandler((event) => {
  requireAuth(event)
  return getGameAccountSettings()
})
