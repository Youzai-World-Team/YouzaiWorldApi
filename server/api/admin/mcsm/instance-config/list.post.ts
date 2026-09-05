import { requireFeaturePermission } from '../../../../utils/db'
import { listProcessConfigFiles } from '../../../../utils/mcsm-instance'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-instance-config', 'view')
  const body = await readBody<{ uuid?: string; daemonId?: string; files?: unknown }>(event)
  return {
    files: await listProcessConfigFiles(String(body?.uuid || ''), String(body?.daemonId || ''), body?.files),
  }
})
