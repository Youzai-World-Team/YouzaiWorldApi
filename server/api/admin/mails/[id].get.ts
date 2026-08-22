import { getAdminGameMailDetail, requireAuth } from '../../../utils/db'
import { requireMailId } from '../../../utils/game-input'

/** 后台单封邮件详情（只读）：正文、附件与逐收件人的读 / 星标 / 领取状态。 */
export default defineEventHandler((event) => {
  requireAuth(event)
  const id = requireMailId(getRouterParam(event, 'id'))
  const detail = getAdminGameMailDetail(id)
  if (!detail) throw createError({ statusCode: 404, statusMessage: '邮件不存在' })
  return detail
})
