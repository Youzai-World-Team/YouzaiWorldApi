import { requirePagePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { getFileStatus } from '../../../../utils/mcsm-files'

export default defineEventHandler(async (event) => {
  requirePagePermission(event, 'server-files', 'view')
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await assertInstanceAllowed(uuid, daemonId)
  return getFileStatus(uuid, daemonId)
})
