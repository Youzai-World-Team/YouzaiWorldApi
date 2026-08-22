import { deleteGameMailbox, requireGameApiKey } from '../../../utils/db'
import { requirePlayerUuid } from '../../../utils/game-input'

/** 账户注销时清空该玩家的收件箱；邮件正文保留，其他收件人不受影响。 */
export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const uuid = requirePlayerUuid(getQuery(event).uuid)
  return { ok: true, removed: deleteGameMailbox(uuid) }
})
