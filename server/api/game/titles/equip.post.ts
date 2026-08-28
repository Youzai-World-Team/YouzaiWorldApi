import {
  gamePlayerTitleSnapshotWire,
  gameTitleWire,
  listGameTitles,
  requireGameApiKey,
  setGamePlayerEquippedTitle,
} from '../../../utils/db'
import { requireGameUsername } from '../../../utils/game-input'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const username = requireGameUsername(body?.username)
  const snapshot = setGamePlayerEquippedTitle(username, body?.title_id)
  return {
    titles: listGameTitles(false).map(gameTitleWire),
    player: gamePlayerTitleSnapshotWire(snapshot),
  }
})
