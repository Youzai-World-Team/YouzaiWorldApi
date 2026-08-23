import { recordAudit, requireOwner, updateAdminPagePermissions } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const actor = requireOwner(event)
  const userId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(userId) || userId <= 0) {
    throw createError({ statusCode: 400, statusMessage: '用户编号无效' })
  }
  const body = await readBody<{ permissions?: Record<string, unknown> }>(event)
  const user = updateAdminPagePermissions(userId, body?.permissions || {})
  recordAudit(event, actor, `更新后台用户页面权限：${user.username}`)
  return user
})
