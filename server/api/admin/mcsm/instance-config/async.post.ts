import { requireFeaturePermission } from '../../../../utils/db'
import { startInstanceAsyncTask } from '../../../../utils/mcsm-instance'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-instance-config', 'edit')
  const body = await readBody<Record<string, unknown>>(event)
  return startInstanceAsyncTask(String(body?.uuid || ''), String(body?.daemonId || ''), body?.taskName, body?.parameter)
})
