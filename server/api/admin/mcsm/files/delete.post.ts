import { recordAudit, requireFeaturePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { deleteEntries } from '../../../../utils/mcsm-files'

/**
 * 批量删除。目录会被递归删除，且面板侧没有回收站——删掉就没了。
 * 路径全部写进操作记录，事后才能查是谁删了什么。
 */
export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-files-delete', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; paths?: unknown }>(event)

  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)

  const paths = await deleteEntries(uuid, daemonId, body?.paths)
  const summary = paths.slice(0, 10).join('、') + (paths.length > 10 ? ` 等 ${paths.length} 项` : '')
  recordAudit(event, user, `删除实例「${instance.nickname || uuid}」的文件：${summary}`)
  return { ok: true, count: paths.length }
})
