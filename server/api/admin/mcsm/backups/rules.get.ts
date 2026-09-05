import { requireFeaturePermission } from '../../../../utils/db'
import { getBackupRules } from '../../../../utils/mcsm-backup'
import { assertInstanceAllowed } from '../../../../utils/mcsm'

/** 读取整实例备份使用的 .epbaklst 黑白名单。 */
export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-backup', 'view')
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await assertInstanceAllowed(uuid, daemonId)
  return getBackupRules(uuid, daemonId)
})
