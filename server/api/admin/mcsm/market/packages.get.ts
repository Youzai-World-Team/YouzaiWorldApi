import { requireFeaturePermission } from '../../../../utils/db'
import { getMarketPackages } from '../../../../utils/mcsm-overview'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-market', 'view')
  return getMarketPackages()
})
