import { recordAudit, requireFeaturePermission, requirePagePermission } from '../../../utils/db'
import { assertInstanceAllowed, sendCommand } from '../../../utils/mcsm'

const STATS_UPLOAD_COMMAND = 'yzwc status upload'

/** 只发送固定的统计上传命令，不把任意控制台命令暴露给游戏统计页面。 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  // 页面本身仍需可见；立即同步是只读统计页上的独立操作权限。
  requirePagePermission(event, 'game-stats', 'view')
  const user = requireFeaturePermission(event, 'game-stats-sync', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string }>(event)
  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)
  if (instance.status !== 3) {
    throw createError({
      statusCode: 409,
      statusMessage: `实例「${instance.nickname || uuid}」当前不是运行状态，无法触发统计上传`,
    })
  }

  await sendCommand(uuid, daemonId, STATS_UPLOAD_COMMAND)
  recordAudit(event, user, `触发实例「${instance.nickname || uuid}」立即上传游戏统计`)
  return { ok: true, command: STATS_UPLOAD_COMMAND, instance: instance.nickname || uuid }
})
