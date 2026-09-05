import { requireFeaturePermission } from '../../../../utils/db'
import { getModConfigFiles } from '../../../../utils/mcsm-mods'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-mods', 'view')
  const query = getQuery(event)
  return getModConfigFiles(
    String(query.uuid || ''),
    String(query.daemonId || ''),
    query.modId,
    query.type,
    query.fileName,
  )
})
