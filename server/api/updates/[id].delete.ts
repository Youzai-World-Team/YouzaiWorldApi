export default defineEventHandler(async (event) => {
  requireAuth(event)

  const id = getRouterParam(event, 'id')
  if (!listUpdates().some((u) => u.id === id)) {
    throw createError({ statusCode: 404, statusMessage: '记录不存在' })
  }

  deleteUpdate(id)
  return { ok: true }
})
