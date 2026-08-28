import {
  gamePlayerTitleSnapshotWire,
  gameTitleWire,
  listGamePlayerTitleSnapshots,
  listGameTitles,
  requirePagePermission,
} from '../../utils/db'

export default defineEventHandler((event) => {
  requirePagePermission(event, 'game-titles', 'view')
  return {
    titles: listGameTitles(true).map(gameTitleWire),
    players: listGamePlayerTitleSnapshots().map(gamePlayerTitleSnapshotWire),
  }
})
