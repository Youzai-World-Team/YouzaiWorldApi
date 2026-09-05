import { requireFeaturePermission } from '../../../../utils/db'
import { searchMods } from '../../../../utils/mcsm-mods'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-mods', 'view')
  return searchMods(getQuery(event))
})
