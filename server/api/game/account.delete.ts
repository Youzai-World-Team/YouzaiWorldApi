import { deleteGameAccount, deleteGameCosmetics, getGameAccount, requireGameApiKey } from '../../utils/db'
import { requireGameUsername } from '../../utils/game-input'

export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const username = requireGameUsername(getQuery(event).username)
  const account = getGameAccount(username)
  if (!account) return { ok: true }
  const deleted = deleteGameAccount(username)
  if (account.uuid) deleteGameCosmetics(account.uuid)
  return { ok: deleted }
})
