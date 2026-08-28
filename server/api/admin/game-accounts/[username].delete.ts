import { createError } from 'h3'
import { deleteGameAccount, deleteGameCosmetics, getGameAccount, requireFeaturePermission } from '../../../utils/db'

export default defineEventHandler((event) => {
  requireFeaturePermission(event, 'game-accounts-manage', 'edit')
  const username = String(getRouterParam(event, 'username') || '').trim()
  const account = getGameAccount(username)
  if (!account) throw createError({ statusCode: 404, statusMessage: '账户不存在' })
  const ok = deleteGameAccount(username)
  if (account.uuid) deleteGameCosmetics(account.uuid)
  return { ok }
})
