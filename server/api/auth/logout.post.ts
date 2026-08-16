export default defineEventHandler(async (event) => {
  const cookie = getCookie(event, 'youzai_token')
  const header = getHeader(event, 'authorization')?.replace('Bearer ', '')
  const token = cookie || header

  if (token) {
    deleteSession(token)
  }

  return { ok: true }
})
