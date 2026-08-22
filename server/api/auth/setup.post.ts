import { initializeAdmin } from '../../utils/db'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const body = await readBody<{
    username?: string
    entry?: string
    password?: string
    confirmPassword?: string
    turnstileSiteKey?: string
    turnstileSecret?: string
    turnstileHostnames?: string
    gameApiKey?: string
  }>(event)
  const password = String(body?.password ?? '')
  if (password !== String(body?.confirmPassword ?? '')) {
    throw createError({ statusCode: 400, statusMessage: '两次输入的密码不一致' })
  }
  const entry = initializeAdmin(
    body?.username,
    password,
    body?.entry,
    body?.turnstileSiteKey,
    body?.turnstileSecret,
    body?.turnstileHostnames,
    body?.gameApiKey,
  )
  return { ok: true, entry }
})
