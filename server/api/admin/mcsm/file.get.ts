import { requirePagePermission } from '../../../utils/db'
import { assertManagedInstanceAllowed } from '../../../utils/mcsm'
import { readTextFile } from '../../../utils/mcsm-files'

/** 读取文本文件，供 Monaco 编辑器打开。 */
export default defineEventHandler(async (event) => {
  requirePagePermission(event, 'server-files', 'view')
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await assertManagedInstanceAllowed(uuid, daemonId)
  return readTextFile(uuid, daemonId, query.path)
})
