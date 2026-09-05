import { requireFeaturePermission } from '../../../utils/db'
import { getDesktopLayout } from '../../../utils/mcsm-overview'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'server-manage-overview', 'view')
  return getDesktopLayout()
})
