import { gameMailWire, requireGameApiKey, setGameMailHidden } from '../../../utils/db'
import { requireMailId } from '../../../utils/game-input'

/** 编辑期间隐藏 / 恢复邮件：隐藏的邮件不会出现在任何玩家的收件箱里。 */
export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const id = requireMailId(body?.id)
  if (typeof body?.hidden !== 'boolean') {
    throw createError({ statusCode: 400, message: '隐藏标记参数不正确' })
  }
  const result = setGameMailHidden(id, body.hidden)
  return { ok: true, mail: gameMailWire(result.mail), recipients: result.recipients }
})
