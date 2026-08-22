import { gameMailWire, insertGameMail, requireGameApiKey } from '../../utils/db'
import {
  optionalMailExpireTime,
  requireMailAttachments,
  requireMailBody,
  requireMailRecipients,
  requireMailScopeSummary,
  requireMailSender,
  requireMailTargets,
  requireMailTitle,
  requireMailType,
} from '../../utils/game-input'

/** 发布邮件。收件人由模组解析接收范围后给出（NONADMIN / ROLE 需要 LuckPerms）。 */
export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const type = requireMailType(body?.type)
  const attachments = requireMailAttachments(body?.attachments)
  if (type === 'REWARD' && attachments.length === 0) {
    throw createError({ statusCode: 400, message: '奖励邮件必须至少包含一个附件' })
  }
  const result = insertGameMail({
    type,
    sender: requireMailSender(body?.sender),
    targets: requireMailTargets(body?.targets),
    scopeSummary: requireMailScopeSummary(body?.scope_summary),
    title: requireMailTitle(body?.title),
    body: requireMailBody(body?.body),
    expireTime: optionalMailExpireTime(body?.expire_time),
    attachments,
  }, requireMailRecipients(body?.recipients))
  return { ok: true, mail: gameMailWire(result.mail), recipients: result.recipients }
})
