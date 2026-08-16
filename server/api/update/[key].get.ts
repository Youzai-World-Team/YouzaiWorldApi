export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key') ?? ''
  const target = listUpdates().find((u) => u.key === key)

  if (!target) {
    throw createError({ statusCode: 404, statusMessage: '未找到该程序的更新信息' })
  }

  return {
    latestVersion: target.latestVersion,
    type: target.type,
    forcedUpdate: target.forcedUpdate,
    release_date: target.release_date,
    release_time: target.release_time,
    changelog: target.changelog,
  }
})
