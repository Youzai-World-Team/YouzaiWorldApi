export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  return { valid: true, user }
})
