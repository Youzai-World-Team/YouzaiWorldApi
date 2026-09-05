import { requireFeaturePermission } from '../../../../utils/db'
import { getBackupTask } from '../../../../utils/mcsm-backup'
import { assertInstanceAllowed } from '../../../../utils/mcsm'

/** 查询由当前页面启动的原生备份异步任务。 */
export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-backup', 'view')
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await assertInstanceAllowed(uuid, daemonId)
  return { task: await getBackupTask(uuid, daemonId, query.taskId) }
})
