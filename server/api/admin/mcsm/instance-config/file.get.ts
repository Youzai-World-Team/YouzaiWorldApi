import { requireFeaturePermission } from '../../../../utils/db'
import { readProcessConfigFile } from '../../../../utils/mcsm-instance'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-instance-config', 'view')
  const query = getQuery(event)
  return readProcessConfigFile(
    String(query.uuid || ''),
    String(query.daemonId || ''),
    query.fileName,
    query.type,
  )
})
