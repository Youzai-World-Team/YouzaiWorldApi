import { recordAudit, requireFeaturePermission } from '../../../utils/db'
import { assertInstanceAllowed } from '../../../utils/mcsm'
import { writeTextFile } from '../../../utils/mcsm-files'

/**
 * 保存在线编辑的文本文件。
 * <p>
 * 整份覆盖写，没有并发保护——两个人同时编辑同一个文件，后保存的会盖掉先保存的。
 * 这里只记录路径与体积，不把文件内容写进操作记录（模组配置动辄几十 KB）。
 * </p>
 */
export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-files-edit', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; path?: string; text?: string }>(event)

  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)

  const text = String(body?.text ?? '')
  await writeTextFile(uuid, daemonId, body?.path, text)
  recordAudit(
    event,
    user,
    `编辑实例「${instance.nickname || uuid}」的文件 ${String(body?.path || '')}（${text.length} 字符）`,
  )
  return { ok: true }
})
