import { requirePagePermission } from '../../../utils/db'
import { assertInstanceAllowed } from '../../../utils/mcsm'
import { listFiles } from '../../../utils/mcsm-files'

/** 列出实例目录内容，附带类型判定（可编辑 / 可预览）供「服务器文件」页分派。 */
export default defineEventHandler(async (event) => {
  requirePagePermission(event, 'server-files', 'view')
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await assertInstanceAllowed(uuid, daemonId)
  return listFiles(uuid, daemonId, query.path, query.page)
})
