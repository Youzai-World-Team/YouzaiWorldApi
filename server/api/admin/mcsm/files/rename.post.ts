import { recordAudit, requirePagePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { renameEntry } from '../../../../utils/mcsm-files'

/** 重命名。面板没有独立的 rename，内部用 move 在同目录内改名。 */
export default defineEventHandler(async (event) => {
  const user = requirePagePermission(event, 'server-files', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; path?: string; name?: string }>(event)

  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)

  const from = String(body?.path || '')
  const target = await renameEntry(uuid, daemonId, from, body?.name)
  recordAudit(event, user, `重命名实例「${instance.nickname || uuid}」的 ${from} → ${target}`)
  return { ok: true, path: target }
})
