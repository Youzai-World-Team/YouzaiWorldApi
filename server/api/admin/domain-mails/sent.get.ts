import { listDomainMailSent, requireAuth } from '../../../utils/db'

/** 后台域名邮件已发送列表：所有者可见全部，其它用户只见自己发送的记录。 */
export default defineEventHandler((event) => {
  const user = requireAuth(event)
  return listDomainMailSent(user.id)
})
