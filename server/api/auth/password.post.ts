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

  const body = await readBody<{ oldPassword?: string; newPassword?: string }>(event)
  if (!body.oldPassword || !body.newPassword) {
    throw createError({ statusCode: 400, statusMessage: '参数不完整' })
  }

  const config = await readJson<{ password: string }>('config.json', { password: '123456' })
  if (body.oldPassword !== config.password) {
    throw createError({ statusCode: 401, statusMessage: '当前密码错误' })
  }

  await writeJson('config.json', { password: body.newPassword })
  return { ok: true }
})
