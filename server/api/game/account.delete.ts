import { deleteGameAccount, deleteGameCosmetics, getGameAccount, requireGameApiKey } from '../../utils/db'

export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const username = String(getQuery(event).username || '').trim()
  const account = getGameAccount(username)
  if (!account) return { ok: true }
  const deleted = deleteGameAccount(username)
  if (account.uuid) deleteGameCosmetics(account.uuid)
  return { ok: deleted }
})
