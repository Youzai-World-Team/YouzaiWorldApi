import { getPublicTurnstileConfig, isAdminInitialized } from '../../utils/db'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { initialized: isAdminInitialized(), turnstile: getPublicTurnstileConfig() }
})
