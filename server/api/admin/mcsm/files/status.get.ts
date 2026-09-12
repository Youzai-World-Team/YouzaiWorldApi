import { requirePagePermission } from '../../../../utils/db'
import { assertManagedInstanceAllowed } from '../../../../utils/mcsm'
import { getFileStatus } from '../../../../utils/mcsm-files'

export default defineEventHandler(async (event) => {
  requirePagePermission(event, 'server-files', 'view')
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await assertManagedInstanceAllowed(uuid, daemonId)
  return getFileStatus(uuid, daemonId)
})
