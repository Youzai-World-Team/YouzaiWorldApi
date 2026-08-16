export default defineEventHandler(async (event) => {
  requireAuth(event)
  return { valid: true }
})
