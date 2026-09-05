import { recordAudit, requireFeaturePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { toggleMod } from '../../../../utils/mcsm-mods'

export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-mods', 'edit')
  const body = await readBody<{ uuid?: string; daemonId?: string; fileName?: string }>(event)
  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)
  const result = await toggleMod(uuid, daemonId, body?.fileName)
  recordAudit(event, user, `切换实例「${instance.nickname || uuid}」的 Mod 文件 ${String(body?.fileName || '')}`)
  return result
})
