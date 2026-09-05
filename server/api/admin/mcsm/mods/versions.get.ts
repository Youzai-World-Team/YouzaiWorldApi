import { requireFeaturePermission } from '../../../../utils/db'
import { getModVersions } from '../../../../utils/mcsm-mods'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-mods', 'view')
  const query = getQuery(event)
  return getModVersions(query.projectId, query.source)
})
