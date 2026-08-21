import { requireGameApiKey, setGameAccountSettings } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  return setGameAccountSettings({
    sessionTimeout: body?.sessionTimeout ?? body?.['session_timeout'],
    loginCooldown: body?.loginCooldown ?? body?.['login_cooldown'],
  })
})
