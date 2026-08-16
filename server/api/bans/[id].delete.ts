export default defineEventHandler(async (event) => {
  requireAuth(event)

  const id = getRouterParam(event, 'id')
  if (!listBans().some((b) => b.id === id)) {
    throw createError({ statusCode: 404, statusMessage: '记录不存在' })
  }

  deleteBan(id)
  return { ok: true }
})
