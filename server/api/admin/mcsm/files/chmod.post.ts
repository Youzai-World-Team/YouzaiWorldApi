import { recordAudit, requireFeaturePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { chmodEntries } from '../../../../utils/mcsm-files'

export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-files-edit', 'edit')
  const body = await readBody<Record<string, unknown>>(event)
  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)
  const result = await chmodEntries(uuid, daemonId, body?.paths, body?.mode, body?.deep)
  recordAudit(event, user, `修改实例「${instance.nickname || uuid}」的文件权限`)
  return result
})
