import { deleteGameSessionsForUser, getGameAccount, hashGamePassword, requireGameApiKey, upsertGameAccount, verifyGamePassword } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<{ username?: string; oldPassword?: string; newPassword?: string }>(event)
  const account = getGameAccount(String(body?.username || ''))
  if (!account?.password) throw createError({ statusCode: 404, statusMessage: '账户不存在' })
  const newPassword = String(body?.newPassword || '')
  if (newPassword.length < 4 || newPassword.length > 128) throw createError({ statusCode: 400, statusMessage: '新密码长度不符合要求' })
  if (!verifyGamePassword(String(body?.oldPassword || ''), account.password)) {
    throw createError({ statusCode: 401, statusMessage: '当前密码错误' })
  }
  account.password = hashGamePassword(newPassword)
  account.lastIp = ''
  account.lastAuthenticatedDate = '1970-01-01T00:00:00Z'
  deleteGameSessionsForUser(account.username)
  upsertGameAccount(account)
  return { ok: true }
})
