import { requireAuth } from '../../utils/db'
import { offlinePlayerUuid, requireGameUsername } from '../../utils/game-input'

export default defineEventHandler((event) => {
  requireAuth(event)
  const username = requireGameUsername(getQuery(event).username)
  return { username, uuid: offlinePlayerUuid(username) }
})
