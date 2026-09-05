import { recordAudit, requireFeaturePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { updateInstanceSettings } from '../../../../utils/mcsm-instance'

export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-instance-config', 'edit')
  const body = await readBody<Record<string, unknown>>(event)
  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)
  await updateInstanceSettings(uuid, daemonId, body?.settings)
  recordAudit(event, user, `修改实例「${instance.nickname || uuid}」的运行设置`)
  return { ok: true }
})
