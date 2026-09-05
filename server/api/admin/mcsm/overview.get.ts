import { requireFeaturePermission } from '../../../utils/db'
import { getPanelOverview } from '../../../utils/mcsm-overview'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-overview', 'view')
  return getPanelOverview()
})
