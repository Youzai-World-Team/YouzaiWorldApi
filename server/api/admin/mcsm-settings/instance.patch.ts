import { normalizeMcsmInstanceTarget } from '#shared/mcsm-instance'
import { getMcsmConfig, recordAudit, requireFeaturePermission, setMcsmManagedInstance } from '../../../utils/db'
import { assertInstanceAllowed } from '../../../utils/mcsm'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const user = requireFeaturePermission(event, 'settings-mcsm', 'edit')
  const body = await readBody<{ managedInstance?: unknown }>(event)
  if (body?.managedInstance === null) {
    setMcsmManagedInstance(null)
    recordAudit(event, user, '取消服务器管理实例绑定')
    return { managedInstance: null }
  }
  const target = normalizeMcsmInstanceTarget(body?.managedInstance)
  if (!target) {
    throw createError({ statusCode: 400, statusMessage: '请选择有效的管理实例' })
  }
  const connection = getMcsmConfig()
  const instance = await assertInstanceAllowed(target.instanceUuid, target.daemonId)
  const latestConnection = getMcsmConfig()
  if (connection.baseUrl !== latestConnection.baseUrl || connection.apiKey !== latestConnection.apiKey) {
    throw createError({ statusCode: 409, statusMessage: '面板连接配置已变更，请刷新实例列表后重新选择' })
  }
  const managedInstance = setMcsmManagedInstance(target)
  recordAudit(event, user, `设置服务器管理实例为「${instance.nickname || target.instanceUuid}」（${target.daemonId}/${target.instanceUuid}）`)
  return { managedInstance }
})
