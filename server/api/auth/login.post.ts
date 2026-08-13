import { randomBytes } from 'node:crypto'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ password?: string }>(event)
  const config = await readJson<{ password: string }>('config.json', { password: '123456' })

  if (!body.password || body.password !== config.password) {
    throw createError({ statusCode: 401, statusMessage: '密码错误' })
  }

  const token = randomBytes(24).toString('hex')
  const sessions = await readJson<Record<string, number>>('sessions.json', {})
  sessions[token] = Date.now()
  await writeJson('sessions.json', sessions)

  return { token }
})
