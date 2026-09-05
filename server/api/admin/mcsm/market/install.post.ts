import { recordAudit, requireFeaturePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { installMarketPackage } from '../../../../utils/mcsm-overview'

export default defineEventHandler(async (event) => {
  const user = requireFeaturePermission(event, 'server-manage-market', 'edit')
  const body = await readBody<Record<string, unknown>>(event)
  const uuid = String(body?.uuid || '')
  const daemonId = String(body?.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)
  const result = await installMarketPackage(uuid, daemonId, body?.title, body?.description)
  recordAudit(event, user, `向实例「${instance.nickname || uuid}」提交 Market 预设包安装`)
  return result
})
