import {
  getDomainMailAccessUser,
  recordAudit,
  requireOwner,
  updateAdminPermissions,
} from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const actor = requireOwner(event)
  const userId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(userId) || userId <= 0) {
    throw createError({ statusCode: 400, statusMessage: '用户编号无效' })
  }
  const body = await readBody<{
    permissions?: Record<string, unknown>
    featurePermissions?: Record<string, unknown>
    domainMailPrefixes?: unknown
  }>(event)
  const user = updateAdminPermissions(
    userId,
    body?.permissions || {},
    body?.featurePermissions || {},
    body?.domainMailPrefixes,
  )
  const domainMail = getDomainMailAccessUser(user.id)
  recordAudit(event, actor, body?.domainMailPrefixes === undefined
    ? `更新后台用户权限：${user.username}`
    : `更新后台用户权限及域名邮件追加可见前缀：${user.username}`)
  return { ...user, domainMail: domainMail || null }
})
