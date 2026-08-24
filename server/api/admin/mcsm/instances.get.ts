import { getAdminMcsmConfig, requireAuth } from '../../../utils/db'
import { getPanelSnapshot } from '../../../utils/mcsm'

/**
 * 「服务器管理」页的入口数据：面板是否配置好、当前 ApiKey 的身份、可管理的实例列表。
 * <p>
 * 面板没配时不报错，返回 {@code configured: false} 让页面引导去站点设置；
 * 配了但连不上才把错误抛出去。
 * </p>
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  const config = getAdminMcsmConfig()
  if (!config.configured) {
    return { configured: false, backupDir: config.backupDir, user: null, instances: [] }
  }

  const snapshot = await getPanelSnapshot()
  return {
    configured: true,
    backupDir: config.backupDir,
    baseUrl: config.baseUrl,
    user: snapshot.user,
    instances: snapshot.instances,
  }
})
