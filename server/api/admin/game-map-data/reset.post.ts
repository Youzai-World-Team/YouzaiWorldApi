import { clearGameMapData, recordAudit, requireFeaturePermission, updateGameMapResetRequest } from '../../../utils/db'
import { gameMapId } from '../../../utils/game-map-input'
import { requestGameMapUpload } from '../../../utils/game-map-upload'

const MAX_RESET_WORLDS = 64

export default defineEventHandler(async event => {
  const user = requireFeaturePermission(event, 'settings-game-maps', 'edit')
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const body = await readBody<{ world?: unknown; confirmed?: unknown; expected?: unknown }>(event)
  if (body?.confirmed !== true) throw createError({ statusCode: 400, statusMessage: '请先确认要清空的地图范围' })
  const world = body.world === 'all' ? null : gameMapId(body.world)
  if (!Array.isArray(body.expected) || body.expected.length > MAX_RESET_WORLDS) throw createError({ statusCode: 400, statusMessage: '请刷新地图统计并确认要清空的存档' })
  const expected: Record<string, string> = Object.create(null)
  for (const value of body.expected) {
    if (!value || typeof value !== 'object') throw createError({ statusCode: 400, statusMessage: '地图存档信息无效' })
    const id = gameMapId(value.world_id), dataId = gameMapId(value.data_id)
    if (expected[id]) throw createError({ statusCode: 400, statusMessage: '地图存档信息重复' })
    expected[id] = dataId
  }
  const reset = clearGameMapData(world, expected)
  recordAudit(event, user, `清空地图「${reset.world_name}」：${reset.removed_worlds} 个存档、${reset.removed_tiles} 个图层区块、${reset.removed_players} 位玩家位置，要求重新全量上传`)
  const request = await requestGameMapUpload()
  updateGameMapResetRequest(reset.id, request)
  return { ...reset, ...request }
})
