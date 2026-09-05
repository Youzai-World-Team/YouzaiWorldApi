import { requireFeaturePermission } from '../../../../utils/db'
import { getMarketConfig } from '../../../../utils/mcsm-overview'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-market', 'view')
  return getMarketConfig()
})
