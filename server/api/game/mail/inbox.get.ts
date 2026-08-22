import {
  countGameMailUnread,
  gameMailRefWire,
  gameMailWire,
  listGameMailInbox,
  requireGameApiKey,
} from '../../../utils/db'
import { requirePlayerUuid } from '../../../utils/game-input'

/**
 * 玩家收件箱。keep_starred 对应模组配置 {@code mail_module.keep_starred_after_expire}：
 * 为 false 时顺带剔除过期未星标的引用。隐藏中的邮件不下发。
 */
export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const query = getQuery(event)
  const uuid = requirePlayerUuid(query.uuid)
  const keepStarred = String(query.keep_starred ?? 'true') !== 'false'
  const entries = listGameMailInbox(uuid, keepStarred).map((entry) => ({
    ref: gameMailRefWire(entry.ref),
    mail: gameMailWire(entry.mail),
  }))
  return { ok: true, uuid, entries, unread: countGameMailUnread(uuid) }
})
