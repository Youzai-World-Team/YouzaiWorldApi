export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const user = requireAuth(event, { allowExpired: true })
  return { valid: true, user }
})
