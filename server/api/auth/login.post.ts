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

  const ip = getRequestIP(event) || 'unknown'
  const history = await readJson<{ ip: string; time: number }[]>('login-history.json', [])
  history.push({ ip, time: Date.now() })
  await writeJson('login-history.json', history.slice(-10))

  return { token }
})
