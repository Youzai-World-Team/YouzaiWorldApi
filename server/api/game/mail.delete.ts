import { deleteGameMail, requireGameApiKey } from '../../utils/db'
import { requireMailId } from '../../utils/game-input'

/** 撤回邮件：删除正文与全部收件箱引用，返回原收件人便于模组推送移除。 */
export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const id = requireMailId(getQuery(event).id)
  const result = deleteGameMail(id)
  return { ok: result.removed, recipients: result.recipients }
})
