import { requireAuth, setGameAccountSettings } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const body = await readBody<any>(event)
  return setGameAccountSettings({
    sessionTimeout: body?.sessionTimeout,
    loginCooldown: body?.loginCooldown,
  })
})
