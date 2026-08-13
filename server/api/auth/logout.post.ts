export default defineEventHandler(async (event) => {
  const cookie = getCookie(event, 'youzai_token')
  const header = getHeader(event, 'authorization')?.replace('Bearer ', '')
  const token = cookie || header

  if (token) {
    const sessions = await readJson<Record<string, number>>('sessions.json', {})
    delete sessions[token]
    await writeJson('sessions.json', sessions)
  }

  return { ok: true }
})
