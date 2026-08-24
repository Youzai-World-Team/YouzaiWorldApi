import { getDomainMailDetail, requireAuth } from '../../../utils/db'
import { UUID_RE } from '../../../utils/game-input'

/** 后台单封域名邮件详情（只读）：正文、收件人/抄送与附件元信息。 */
export default defineEventHandler((event) => {
  requireAuth(event)
  const id = String(getRouterParam(event, 'id') || '').trim().toLowerCase()
  if (!UUID_RE.test(id)) throw createError({ statusCode: 400, statusMessage: '邮件 ID 格式不正确' })
  const detail = getDomainMailDetail(id)
  if (!detail) throw createError({ statusCode: 404, statusMessage: '邮件不存在' })
  return detail
})
