export default defineEventHandler(async (event) => {
  requireAuth(event)

  const id = getRouterParam(event, 'id')
  if (!listActivities().some((a) => a.id === id)) {
    throw createError({ statusCode: 404, statusMessage: '记录不存在' })
  }

  deleteActivity(id)
  return { ok: true }
})
