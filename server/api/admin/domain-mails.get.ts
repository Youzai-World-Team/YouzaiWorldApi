import { listDomainMails, requireAuth } from '../../utils/db'

/** 后台域名邮件列表（只读）：不含正文与附件二进制，正文留给详情接口。 */
export default defineEventHandler((event) => {
  requireAuth(event)
  return listDomainMails()
})
