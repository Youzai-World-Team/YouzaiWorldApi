import { deleteGameAccount, deleteGameCosmetics, getGameAccount, requireGameApiKey, verifyGamePassword } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<{ username?: string; password?: string }>(event)
  const username = String(body?.username || '')
  const account = getGameAccount(username)
  if (!account?.password) throw createError({ statusCode: 404, statusMessage: '账户不存在' })
  if (!verifyGamePassword(String(body?.password || ''), account.password)) {
    throw createError({ statusCode: 401, statusMessage: '密码错误' })
  }
  deleteGameAccount(username)
  if (account.uuid) deleteGameCosmetics(account.uuid)
  return { ok: true }
})
