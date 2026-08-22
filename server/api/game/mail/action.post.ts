import { applyGameMailAction, gameMailRefWire, requireGameApiKey } from '../../../utils/db'
import { requireMailAction, requireMailId, requirePlayerUuid } from '../../../utils/game-input'

/** 玩家侧邮件状态变更：已读 / 星标 / 取消星标 / 删除。领取奖励走 claim 接口。 */
export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const uuid = requirePlayerUuid(body?.uuid)
  const mailId = requireMailId(body?.mail_id)
  const result = applyGameMailAction(uuid, mailId, requireMailAction(body?.action))
  return {
    ok: true,
    ref: result.ref ? gameMailRefWire(result.ref) : null,
    unread: result.unread,
  }
})
