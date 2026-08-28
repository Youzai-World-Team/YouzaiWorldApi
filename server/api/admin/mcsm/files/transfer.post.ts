import { recordAudit, requireFeaturePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { transferEntries } from '../../../../utils/mcsm-files'

/** 批量复制或移动到目标目录。 */
export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-files-edit', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; paths?: unknown; toDir?: string; mode?: string }>(event)

  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)

  const mode = String(body?.mode || '')
  if (mode !== 'copy' && mode !== 'move') {
    throw createError({ statusCode: 400, statusMessage: '操作类型只能是 copy 或 move' })
  }

  const count = await transferEntries(uuid, daemonId, body?.paths, body?.toDir, mode)
  recordAudit(
    event,
    user,
    `${mode === 'copy' ? '复制' : '移动'}实例「${instance.nickname || uuid}」的 ${count} 项到 ${String(body?.toDir || '/')}`,
  )
  return { ok: true, count }
})
