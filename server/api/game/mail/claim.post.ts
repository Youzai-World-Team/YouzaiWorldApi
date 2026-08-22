import { claimGameMail, gameMailRefWire, gameMailWire, requireGameApiKey } from '../../../utils/db'
import { requireMailId, requirePlayerUuid } from '../../../utils/game-input'

/**
 * 原子领取奖励：Api 校验并写入 claimed 后返回附件，由模组在游戏内实际发放。
 * 先标记后发放可以杜绝重复领取；发放细节（物品 / 命令 / 经验）仍是模组职责。
 */
export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const uuid = requirePlayerUuid(body?.uuid)
  const mailId = requireMailId(body?.mail_id)
  const result = claimGameMail(uuid, mailId)
  return {
    ok: true,
    mail: gameMailWire(result.mail),
    ref: gameMailRefWire(result.ref),
    unread: result.unread,
  }
})
