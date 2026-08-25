import { requirePagePermission } from '../../../utils/db'
import { assertInstanceAllowed } from '../../../utils/mcsm'
import { readTextFile } from '../../../utils/mcsm-files'

/** 读取文本文件，供 Monaco 编辑器打开。 */
export default defineEventHandler(async (event) => {
  requirePagePermission(event, 'server-files', 'view')
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await assertInstanceAllowed(uuid, daemonId)
  return readTextFile(uuid, daemonId, query.path)
})
