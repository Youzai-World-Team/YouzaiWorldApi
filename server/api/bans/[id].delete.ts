interface Ban {
  id: string
  player: string
  banTime: string
  unbanTime: string
  reason: string
}

export default defineEventHandler(async (event) => {
  const cookie = getCookie(event, 'youzai_token')
  const header = getHeader(event, 'authorization')?.replace('Bearer ', '')
  const token = cookie || header

  if (!token) {
    throw createError({ statusCode: 401, statusMessage: '未登录' })
  }

  const sessions = await readJson<Record<string, number>>('sessions.json', {})
  if (!sessions[token]) {
    throw createError({ statusCode: 401, statusMessage: '会话已失效' })
  }

  const id = getRouterParam(event, 'id')
  const bans = await readJson<Ban[]>('bans.json', [])
  const next = bans.filter((b) => b.id !== id)

  if (next.length === bans.length) {
    throw createError({ statusCode: 404, statusMessage: '记录不存在' })
  }

  await writeJson('bans.json', next)
  return { ok: true }
})