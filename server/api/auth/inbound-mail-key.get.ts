import { getInboundMailKey, inboundMailKeySource, requireFeaturePermission } from '../../utils/db'

/** 域名邮件投递密钥：供站点设置页回显，并说明当前生效的是数据库还是环境变量那一份。 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  requireFeaturePermission(event, 'settings-inbound-mail-key', 'view')
  return { inboundMailKey: getInboundMailKey(), source: inboundMailKeySource() }
})
