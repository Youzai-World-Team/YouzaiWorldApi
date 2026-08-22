import { gameMailRefWire, listGameMailRefsFor, requireGameApiKey } from '../../../utils/db'
import { requireMailId, requirePlayerUuid } from '../../../utils/game-input'

const MAX_BATCH = 500

/**
 * 批量取某封邮件在指定玩家处的引用。
 * 编辑 / 取消编辑后模组用它给每个在线收件人推送带自身状态的条目。
 */
export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const mailId = requireMailId(body?.mail_id)
  if (!Array.isArray(body?.uuids)) {
    throw createError({ statusCode: 400, message: '玩家 UUID 列表格式不正确' })
  }
  if (body.uuids.length > MAX_BATCH) {
    throw createError({ statusCode: 400, message: `一次最多查询 ${MAX_BATCH} 个玩家` })
  }
  const uuids = [...new Set(body.uuids.map((item: unknown) => requirePlayerUuid(item)))] as string[]
  const refs = listGameMailRefsFor(mailId, uuids)
  const wire: Record<string, ReturnType<typeof gameMailRefWire>> = {}
  for (const [playerUuid, ref] of Object.entries(refs)) wire[playerUuid] = gameMailRefWire(ref)
  return { ok: true, mail_id: mailId, refs: wire }
})
