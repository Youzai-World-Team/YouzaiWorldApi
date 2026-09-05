import { requireFeaturePermission } from '../../../../utils/db'
import { listMods } from '../../../../utils/mcsm-mods'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-mods', 'view')
  const query = getQuery(event)
  return listMods(String(query.uuid || ''), String(query.daemonId || ''), query)
})
