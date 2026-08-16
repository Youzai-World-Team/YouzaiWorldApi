import { randomBytes } from 'node:crypto'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ password?: string }>(event)
  const password = getSetting('password') || '123456'

  if (!body.password || body.password !== password) {
    throw createError({ statusCode: 401, statusMessage: '密码错误' })
  }

  const token = randomBytes(24).toString('hex')
  createSession(token)

  const ip = getRequestIP(event) || 'unknown'
  pushLogin(ip, Date.now())

  return { token }
})
