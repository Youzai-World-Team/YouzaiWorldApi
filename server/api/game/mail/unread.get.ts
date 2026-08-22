import { countGameMailUnread, requireGameApiKey } from '../../../utils/db'
import { requirePlayerUuid } from '../../../utils/game-input'

/** 未读邮件数：玩家加入服务器与任意邮件操作后都会回推给客户端徽标。 */
export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const uuid = requirePlayerUuid(getQuery(event).uuid)
  return { ok: true, uuid, unread: countGameMailUnread(uuid) }
})
