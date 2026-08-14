interface Donor {
  id: string
  avatar: string
  name: string
  intro: string
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

  const body = await readBody<{ avatar?: string; name?: string; intro?: string }>(event)

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    throw createError({ statusCode: 400, statusMessage: '名称不能为空' })
  }

  const donors = await readJson<Donor[]>('donors.json', [])
  const donor: Donor = {
    id: `donor_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    avatar: typeof body.avatar === 'string' ? body.avatar : '',
    name: body.name.trim(),
    intro: typeof body.intro === 'string' ? body.intro.trim() : '',
  }
  donors.unshift(donor)
  await writeJson('donors.json', donors)

  return donor
})
