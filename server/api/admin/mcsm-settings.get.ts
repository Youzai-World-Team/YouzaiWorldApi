import { getAdminMcsmConfig, requireFeaturePermission } from '../../utils/db'

/**
 * MCSM 面板配置回显：只给面板地址、备份目录和「ApiKey 是否已配置」。
 * ApiKey 明文永不出网，页面上留空即表示沿用旧值。
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  requireFeaturePermission(event, 'settings-mcsm', 'view')
  return getAdminMcsmConfig()
})
