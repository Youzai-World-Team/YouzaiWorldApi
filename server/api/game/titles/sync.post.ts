import {
  gamePlayerTitleSnapshotWire,
  gameTitleWire,
  listGameTitles,
  requireGameApiKey,
  syncPermissionGameTitles,
} from '../../../utils/db'
import { requireGameUsername } from '../../../utils/game-input'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  if (!Array.isArray(body?.players) || body.players.length > 200) {
    throw createError({ statusCode: 400, statusMessage: '玩家称号同步列表格式不正确' })
  }
  const players = body.players.map((entry: any) => ({
    username: requireGameUsername(entry?.username),
    titleIds: Array.isArray(entry?.permission_title_ids)
      ? entry.permission_title_ids.map((id: unknown) => String(id))
      : [],
  }))
  const snapshots = syncPermissionGameTitles(players)
  return {
    titles: listGameTitles(false).map(gameTitleWire),
    players: snapshots.map(gamePlayerTitleSnapshotWire),
  }
})
