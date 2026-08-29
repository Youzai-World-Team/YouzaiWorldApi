import { getAdminMcsmConfig, requireFeaturePermission } from '../../utils/db'

/** MCSM 面板配置只回给具备对应查看权限的后台用户。 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  requireFeaturePermission(event, 'settings-mcsm', 'view')
  return getAdminMcsmConfig()
})
