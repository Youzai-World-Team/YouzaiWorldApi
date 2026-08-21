import { setAdminEntry } from '../../utils/db'

const RESERVED = ['login', 'account', 'activity', 'donors', 'bans', 'updates', 'api', '_nuxt', 'favicon']

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const body = await readBody<{ entry?: string }>(event)
  const entry = (body.entry || '').trim().replace(/^\/+|\/+$/g, '')

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{11,63}$/.test(entry) || RESERVED.includes(entry)) {
    throw createError({ statusCode: 400, statusMessage: '入口格式不正确或与现有路由冲突' })
  }

  setAdminEntry(entry)
  return { entry }
})
