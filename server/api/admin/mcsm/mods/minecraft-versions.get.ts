import { requireFeaturePermission } from '../../../../utils/db'
import { getMinecraftVersions } from '../../../../utils/mcsm-mods'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-mods', 'view')
  return getMinecraftVersions()
})
