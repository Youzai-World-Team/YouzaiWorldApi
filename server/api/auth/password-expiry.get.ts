import { getPasswordExpiryPolicy, requireAuth } from '../../utils/db'

export default defineEventHandler((event) => {
  requireAuth(event, { allowExpired: true })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return getPasswordExpiryPolicy()
})
