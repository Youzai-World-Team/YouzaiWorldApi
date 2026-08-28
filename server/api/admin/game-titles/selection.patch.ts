import {
  gamePlayerTitleSnapshotWire,
  requireFeaturePermission,
  setGamePlayerEquippedTitle,
} from '../../../utils/db'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'game-titles-grants', 'edit')
  const body = await readBody<any>(event)
  return gamePlayerTitleSnapshotWire(setGamePlayerEquippedTitle(body?.username, body?.title_id))
})
