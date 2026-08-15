const RESERVED = ['login', 'account', 'activity', 'donors', 'bans', 'updates', 'api', '_nuxt', 'favicon']

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

  const body = await readBody<{ entry?: string }>(event)
  const entry = (body.entry || '').trim().replace(/^\/+|\/+$/g, '')

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(entry) || RESERVED.includes(entry)) {
    throw createError({ statusCode: 400, statusMessage: '入口格式不正确或与现有路由冲突' })
  }

  const config = await readJson<{ password: string; entry?: string }>('config.json', { password: '123456' })
  await writeJson('config.json', { ...config, entry })
  return { entry }
})
