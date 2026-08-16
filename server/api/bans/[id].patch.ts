function isValidDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const id = getRouterParam(event, 'id')
  const body = await readBody<{ player?: string; banTime?: string; unbanTime?: string; reason?: string }>(event)

  if (!body.player || typeof body.player !== 'string' || !body.player.trim()) {
    throw createError({ statusCode: 400, statusMessage: '玩家名不能为空' })
  }
  if (!isValidDate(body.banTime || '')) {
    throw createError({ statusCode: 400, statusMessage: '封禁时间格式应为 YYYY-MM-DD' })
  }
  const unban = body.unbanTime || ''
  if (unban !== 'permanent' && !isValidDate(unban)) {
    throw createError({ statusCode: 400, statusMessage: '解封时间格式应为 YYYY-MM-DD 或 permanent' })
  }

  const prev = listBans().find((b) => b.id === id)
  if (!prev) {
    throw createError({ statusCode: 404, statusMessage: '记录不存在' })
  }

  const updated = {
    ...prev,
    player: body.player.trim(),
    banTime: body.banTime,
    unbanTime: unban,
    reason: typeof body.reason === 'string' ? body.reason.trim() : '',
  }
  updateBan(updated)

  return updated
})
