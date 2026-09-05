import { requireFeaturePermission } from '../../../../utils/db'
import { getInstanceOperationLogs } from '../../../../utils/mcsm-overview'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-overview', 'view')
  const query = getQuery(event)
  return getInstanceOperationLogs(String(query.uuid || ''), String(query.daemonId || ''), query.limit)
})
