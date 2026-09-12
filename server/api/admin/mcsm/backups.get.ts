import { requireFeaturePermission } from '../../../utils/db'
import { listBackups } from '../../../utils/mcsm-backup'
import { assertManagedInstanceAllowed } from '../../../utils/mcsm'

/**
 * ElementsPanel 备份插件维护的整实例备份列表。
 */
export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-backup', 'view')
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await assertManagedInstanceAllowed(uuid, daemonId)

  return { backups: await listBackups(uuid, daemonId) }
})
