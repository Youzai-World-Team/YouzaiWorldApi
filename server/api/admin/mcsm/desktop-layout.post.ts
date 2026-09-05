import { recordAudit, requireFeaturePermission } from '../../../utils/db'
import { setDesktopLayout } from '../../../utils/mcsm-overview'

export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-overview', 'edit')
  const body = await readBody(event)
  const result = await setDesktopLayout(body)
  recordAudit(event, user, '淇敼 MCSManager 妗岄潰甯冨眬')
  return result
})
