export default defineEventHandler(async (event) => {
  requireAuth(event)

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

  const prev = listUpdates().find((u) => u.id === id)
  if (!prev) {
    throw createError({ statusCode: 404, statusMessage: '记录不存在' })
  }

  const updated = {
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
  updateUpdate(updated)

  return updated
})
