import { recordAudit, requireFeaturePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { writeProcessConfigFile } from '../../../../utils/mcsm-instance'

export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-instance-config', 'edit')
  const query = getQuery(event)
  const body = await readBody<Record<string, unknown>>(event)
  const uuid = String(query.uuid || body?.uuid || '')
  const daemonId = String(query.daemonId || body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)
  const result = await writeProcessConfigFile(uuid, daemonId, query.fileName || body?.fileName, query.type || body?.type, body?.config)
  recordAudit(event, user, `修改实例「${instance.nickname || uuid}」的进程配置 ${String(query.fileName || body?.fileName || '')}`)
  return result
})
