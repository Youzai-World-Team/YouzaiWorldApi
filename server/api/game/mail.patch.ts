import { gameMailWire, requireGameApiKey, updateGameMail } from '../../utils/db'
import {
  optionalMailExpireTime,
  requireMailAttachments,
  requireMailBody,
  requireMailId,
  requireMailRecipients,
  requireMailScopeSummary,
  requireMailSender,
  requireMailTargets,
  requireMailTitle,
  requireMailType,
} from '../../utils/game-input'

/** 编辑已发布邮件：更新字段并按新收件人列表 diff 收件箱引用。 */
export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const id = requireMailId(body?.id)
  const type = requireMailType(body?.type)
  const attachments = requireMailAttachments(body?.attachments)
  if (type === 'REWARD' && attachments.length === 0) {
    throw createError({ statusCode: 400, message: '奖励邮件必须至少包含一个附件' })
  }
  let hidden: boolean | undefined
  if (body?.hidden !== undefined) {
    if (typeof body.hidden !== 'boolean') {
      throw createError({ statusCode: 400, message: '隐藏标记参数不正确' })
    }
    hidden = body.hidden
  }
  const result = updateGameMail(id, {
    type,
    sender: requireMailSender(body?.sender),
    targets: requireMailTargets(body?.targets),
    scopeSummary: requireMailScopeSummary(body?.scope_summary),
    title: requireMailTitle(body?.title),
    body: requireMailBody(body?.body),
    expireTime: optionalMailExpireTime(body?.expire_time),
    attachments,
  }, requireMailRecipients(body?.recipients), hidden)
  return {
    ok: true,
    mail: gameMailWire(result.mail),
    recipients: result.recipients,
    removed: result.removed,
  }
})
