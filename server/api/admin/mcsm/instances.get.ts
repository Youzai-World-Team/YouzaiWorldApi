import { getAdminMcsmConfig, requireAnyPagePermission } from '../../../utils/db'
import { getPanelSnapshot } from '../../../utils/mcsm'

/**
 * 「服务器管理」和「服务器文件」两页共用的入口数据：面板是否配置好、
 * 当前 ApiKey 的身份、可管理的实例列表。
 * <p>
 * 因为两个页面都要用，它从 {@code pageKeyForApi} 里排除了，改在这里自己判定
 * 「任一页面可见即可」。面板没配时不报错，返回 {@code configured: false}
 * 让页面引导去站点设置。
 * </p>
 */
export default defineEventHandler(async (event) => {
  requireAnyPagePermission(event, ['server-manage', 'server-files'], 'view')
  const config = getAdminMcsmConfig()
  if (!config.configured) {
    return { configured: false, user: null, instances: [] }
  }

  const snapshot = await getPanelSnapshot()
  return {
    configured: true,
    baseUrl: config.baseUrl,
    user: snapshot.user,
    instances: snapshot.instances,
  }
})
