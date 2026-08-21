import { getGameAccountSettings, requireGameApiKey } from '../../utils/db'

export default defineEventHandler((event) => {
  requireGameApiKey(event)
  return getGameAccountSettings()
})
