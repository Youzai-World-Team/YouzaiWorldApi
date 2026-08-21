import { createError } from 'h3'
import { deleteGameAccount, deleteGameCosmetics, getGameAccount, requireAuth } from '../../../utils/db'

export default defineEventHandler((event) => {
  requireAuth(event)
  const username = String(getRouterParam(event, 'username') || '').trim()
  const account = getGameAccount(username)
  if (!account) throw createError({ statusCode: 404, statusMessage: '账户不存在' })
  const ok = deleteGameAccount(username)
  if (account.uuid) deleteGameCosmetics(account.uuid)
  return { ok }
})
