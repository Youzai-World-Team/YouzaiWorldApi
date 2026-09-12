import { requirePagePermission } from '../../../utils/db'
import { assertManagedInstanceAllowed } from '../../../utils/mcsm'
import { listAllFiles, listFiles } from '../../../utils/mcsm-files'

/** 默认列出完整目录；显式传 page 时保留单页读取，附带可编辑 / 可预览的类型判定。 */
export default defineEventHandler(async (event) => {
  requirePagePermission(event, 'server-files', 'view')
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await assertManagedInstanceAllowed(uuid, daemonId)
  return query.page === undefined
    ? listAllFiles(uuid, daemonId, query.path)
    : listFiles(uuid, daemonId, query.path, query.page)
})
