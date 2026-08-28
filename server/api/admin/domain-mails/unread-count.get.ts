import { getUnreadDomainMailCount, requireAuth } from '../../../utils/db'

/** 当前后台用户尚未查看的域名邮件数量，供全局导航轻量轮询。 */
export default defineEventHandler((event) => {
  const user = requireAuth(event)
  return { count: getUnreadDomainMailCount(user.id) }
})
