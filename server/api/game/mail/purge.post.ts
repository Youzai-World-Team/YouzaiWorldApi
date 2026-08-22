import { purgeGameMails, requireGameApiKey } from '../../../utils/db'

/**
 * 清理过期邮件。keep_starred 为真时保留被任意玩家星标过的过期邮件，
 * 并顺带剔除全部悬空收件箱引用；返回受影响玩家便于模组回推未读数。
 */
export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event).catch(() => null)
  const keepStarred = body?.keep_starred === undefined ? true : body.keep_starred === true
  const result = purgeGameMails(keepStarred)
  return {
    ok: true,
    removed: result.removed,
    removed_ids: result.removedIds,
    affected: result.affected,
    pruned_refs: result.prunedRefs,
  }
})
