import { requireFeaturePermission } from '../../../utils/db'
import { getJavaRuntimes } from '../../../utils/mcsm-overview'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-java', 'view')
  const query = getQuery(event)
  return getJavaRuntimes(String(query.uuid || ''), String(query.daemonId || ''))
})
