import { getGameAccount, requireGameApiKey, verifyGamePassword } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<{ username?: string; password?: string }>(event)
  const account = getGameAccount(String(body?.username || ''))
  return { valid: Boolean(account?.password && verifyGamePassword(String(body?.password || ''), account.password)) }
})
