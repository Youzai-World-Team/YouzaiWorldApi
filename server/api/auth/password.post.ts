export default defineEventHandler(async (event) => {
  requireAuth(event)

  const body = await readBody<{ oldPassword?: string; newPassword?: string }>(event)
  if (!body.oldPassword || !body.newPassword) {
    throw createError({ statusCode: 400, statusMessage: '参数不完整' })
  }

  const password = getSetting('password') || '123456'
  if (body.oldPassword !== password) {
    throw createError({ statusCode: 401, statusMessage: '当前密码错误' })
  }

  setSetting('password', body.newPassword)
  return { ok: true }
})
