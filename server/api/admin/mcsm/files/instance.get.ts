import { getMcsmManagedInstance, mcsmConfigured, requirePagePermission } from '../../../../utils/db'
import { assertManagedInstanceAllowed } from '../../../../utils/mcsm'

/** 与服务器管理共用站点绑定，只返回文件页需要的摘要，保留独立页面权限。 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  requirePagePermission(event, 'server-files', 'view')
  const configured = mcsmConfigured()
  const target = getMcsmManagedInstance()
  return {
    configured,
    instanceConfigured: Boolean(target),
    instance: configured && target ? await assertManagedInstanceAllowed(target.instanceUuid, target.daemonId) : null,
  }
})
