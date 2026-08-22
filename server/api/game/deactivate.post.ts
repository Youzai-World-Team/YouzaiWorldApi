import { getHeader } from 'h3'
import { deleteGameAccount, deleteGameCosmetics, requireGameApiKey, requireGameSession, verifyGamePassword } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const token = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw createError({ statusCode: 401, message: '缺少游戏会话' })
  const account = requireGameSession(token)
  const body = await readBody<{ password?: string }>(event)
  if (!account.password) throw createError({ statusCode: 404, message: '账户不存在' })
  if (!verifyGamePassword(String(body?.password || ''), account.password)) {
    throw createError({ statusCode: 401, message: '密码错误' })
  }
  deleteGameAccount(account.username)
  if (account.uuid) deleteGameCosmetics(account.uuid)
  return { ok: true, msg: '账户已注销' }
})
