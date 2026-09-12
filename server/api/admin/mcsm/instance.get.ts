import { getMcsmManagedInstance, mcsmConfigured, requirePagePermission } from '../../../utils/db'
import { getInstanceDetail } from '../../../utils/mcsm'

/** 只返回站点设置指定的管理实例，不接受浏览器指定其他目标。 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  requirePagePermission(event, 'server-manage', 'view')
  const configured = mcsmConfigured()
  const target = getMcsmManagedInstance()
  return {
    configured,
    instanceConfigured: Boolean(target),
    instance: configured && target ? await getInstanceDetail(target.instanceUuid, target.daemonId) : null,
  }
})
