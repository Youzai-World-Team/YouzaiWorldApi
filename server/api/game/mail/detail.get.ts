import {
  computeGameMailEditState,
  gameMailRefWire,
  gameMailWire,
  getGameMail,
  getGameMailRef,
  requireGameApiKey,
} from '../../../utils/db'
import { requireMailId, requirePlayerUuid } from '../../../utils/game-input'

/**
 * 单封邮件详情，编辑预填使用。
 * 同时返回编辑前置判定与查看者自己的引用状态（viewer 可省略）。
 */
export default defineEventHandler((event) => {
  requireGameApiKey(event)
  const query = getQuery(event)
  const id = requireMailId(query.id)
  const mail = getGameMail(id)
  if (!mail) throw createError({ statusCode: 404, message: '邮件不存在或已撤回' })
  const viewer = query.viewer == null || String(query.viewer).trim() === ''
    ? null
    : requirePlayerUuid(query.viewer)
  const ref = viewer ? getGameMailRef(id, viewer) : undefined
  const editState = computeGameMailEditState(mail)
  return {
    ok: true,
    mail: gameMailWire(mail),
    ref: ref ? gameMailRefWire(ref) : null,
    can_edit: editState.canEdit,
    need_hidden: editState.needHidden,
    deny_reason: editState.denyReason,
  }
})
