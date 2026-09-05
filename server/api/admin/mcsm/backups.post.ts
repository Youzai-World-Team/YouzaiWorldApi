import { recordAudit, requireFeaturePermission } from '../../../utils/db'
import { startBackup } from '../../../utils/mcsm-backup'
import { assertInstanceAllowed } from '../../../utils/mcsm'

/**
 * 启动 ElementsPanel 原生整实例备份任务。
 * 原生任务在实例运行时会主动执行 stop，因此这里强制要求实例已经停止，避免隐式停服。
 */
export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-backup', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string }>(event)

  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)
  if (instance.status !== 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `实例当前${instance.statusLabel}，请先手动停止实例再创建备份`,
    })
  }

  const task = await startBackup(uuid, daemonId)
  recordAudit(event, user, `为实例「${instance.nickname || uuid}」启动整实例备份任务`)
  return { ok: true, task }
})
