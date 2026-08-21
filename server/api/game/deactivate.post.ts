import { deleteGameAccount, deleteGameCosmetics, getGameAccount, requireGameApiKey, verifyGamePassword } from '../../utils/db'
import { requireGameUsername } from '../../utils/game-input'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<{ username?: string; password?: string }>(event)
  const username = requireGameUsername(body?.username)
  const account = getGameAccount(username)
  if (!account?.password) throw createError({ statusCode: 404, statusMessage: '账户不存在' })
  if (!verifyGamePassword(String(body?.password || ''), account.password)) {
    throw createError({ statusCode: 401, statusMessage: '密码错误' })
  }
  deleteGameAccount(username)
  if (account.uuid) deleteGameCosmetics(account.uuid)
  return { ok: true }
})
