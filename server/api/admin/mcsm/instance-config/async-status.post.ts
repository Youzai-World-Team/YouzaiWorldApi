import { requireFeaturePermission } from '../../../../utils/db'
import { queryInstanceAsyncTask } from '../../../../utils/mcsm-instance'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-instance-config', 'view')
  const body = await readBody<Record<string, unknown>>(event)
  return queryInstanceAsyncTask(String(body?.uuid || ''), String(body?.daemonId || ''), body?.taskName, body?.parameter)
})
