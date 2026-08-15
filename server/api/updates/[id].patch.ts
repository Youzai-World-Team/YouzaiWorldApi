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
  const body = await readBody<{
    name?: string
    latestVersion?: string
    type?: string
    forcedUpdate?: boolean
    release_date?: string
    release_time?: string
    changelog?: string[]
  }>(event)

  const list = await readJson<UpdateEntry[]>('updates.json', [])
  const idx = list.findIndex((u) => u.id === id)
  if (idx === -1) {
    throw createError({ statusCode: 404, statusMessage: '记录不存在' })
  }

  const prev = list[idx]
  const updated: UpdateEntry = {
    ...prev,
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : prev.name,
    latestVersion:
      typeof body.latestVersion === 'string' && body.latestVersion.trim() ? body.latestVersion.trim() : prev.latestVersion,
    type: typeof body.type === 'string' && body.type.trim() ? body.type.trim() : prev.type,
    forcedUpdate: typeof body.forcedUpdate === 'boolean' ? body.forcedUpdate : prev.forcedUpdate,
    release_date: typeof body.release_date === 'string' && body.release_date.trim() ? body.release_date.trim() : prev.release_date,
    release_time: typeof body.release_time === 'string' && body.release_time.trim() ? body.release_time.trim() : prev.release_time,
    changelog: Array.isArray(body.changelog)
      ? body.changelog.filter((c) => typeof c === 'string' && c.trim())
      : prev.changelog,
  }
  list[idx] = updated
  await writeJson('updates.json', list)

  return updated
})
