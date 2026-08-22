import { getPublicTurnstileConfig } from '../../utils/db'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return getPublicTurnstileConfig()
})
