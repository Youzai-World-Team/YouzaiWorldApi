import { getHeader } from 'h3'
import { deleteGameSessionsForUser, gameAccountWire, hashGamePassword, requireGameApiKey, requireGamePassword, requireGameSession, upsertGameAccount, verifyGamePassword } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const token = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw createError({ statusCode: 401, message: '缺少游戏会话' })
  const account = requireGameSession(token)
  const body = await readBody<{ oldPassword?: string; newPassword?: string }>(event)
  if (!account.password) throw createError({ statusCode: 404, message: '账户不存在' })
  const newPassword = requireGamePassword(body?.newPassword, '新密码')
  if (!verifyGamePassword(String(body?.oldPassword || ''), account.password)) {
    throw createError({ statusCode: 401, message: '当前密码错误' })
  }
  account.password = hashGamePassword(newPassword)
  account.lastIp = ''
  account.lastAuthenticatedDate = '1970-01-01T00:00:00Z'
  deleteGameSessionsForUser(account.username)
  upsertGameAccount(account)
  return { ok: true, msg: '密码修改成功，请重新登录', account: gameAccountWire(account) }
})
