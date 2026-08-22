import { listAdminGameMails, requireAuth } from '../../utils/db'

/** 后台邮件列表（只读）：游戏内已发布的全部邮件及其阅读 / 领取统计。 */
export default defineEventHandler((event) => {
  requireAuth(event)
  return listAdminGameMails()
})
