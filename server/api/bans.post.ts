interface Ban {
  id: string
  player: string
  banTime: string
  unbanTime: string
  reason: string
}

function isValidDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
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

  const bans = await readJson<Ban[]>('bans.json', [])
  const ban: Ban = {
    id: `ban_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    player: body.player.trim(),
    banTime: body.banTime,
    unbanTime: unban,
    reason: typeof body.reason === 'string' ? body.reason.trim() : '',
  }
  bans.unshift(ban)
  await writeJson('bans.json', bans)

  return ban
})