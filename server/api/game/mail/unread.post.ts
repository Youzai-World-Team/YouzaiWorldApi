import { countGameMailUnreadBatch, requireGameApiKey } from '../../../utils/db'
import { requirePlayerUuid } from '../../../utils/game-input'

const MAX_BATCH = 500

/** 批量未读数：群发 / 撤回 / 清理后模组用它一次性刷新所有在线收件人的徽标。 */
export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  if (!Array.isArray(body?.uuids)) {
    throw createError({ statusCode: 400, message: '玩家 UUID 列表格式不正确' })
  }
  if (body.uuids.length > MAX_BATCH) {
    throw createError({ statusCode: 400, message: `一次最多查询 ${MAX_BATCH} 个玩家` })
  }
  const uuids = [...new Set(body.uuids.map((item: unknown) => requirePlayerUuid(item)))] as string[]
  return { ok: true, counts: countGameMailUnreadBatch(uuids) }
})
