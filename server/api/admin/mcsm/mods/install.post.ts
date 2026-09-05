import { recordAudit, requireFeaturePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { installMod } from '../../../../utils/mcsm-mods'

export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-mods', 'edit')
  const body = await readBody<Record<string, unknown>>(event)
  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)
  const result = await installMod(uuid, daemonId, body || {})
  recordAudit(event, user, `向实例「${instance.nickname || uuid}」安装 Mod 文件 ${String(body?.fileName || '')}`)
  return result
})
