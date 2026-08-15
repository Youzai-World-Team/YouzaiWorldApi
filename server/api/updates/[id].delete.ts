interface UpdateEntry {
  id: string
  key: string
  name: string
  latestVersion: string
  type: string
  forcedUpdate: boolean
  release_date: string
  release_time: string
  changelog: string[]
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
  const list = await readJson<UpdateEntry[]>('updates.json', [])
  const target = list.find((u) => u.id === id)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: '记录不存在' })
  }

  const next = list.filter((u) => u.id !== id)
  await writeJson('updates.json', next)

  return { ok: true }
})
