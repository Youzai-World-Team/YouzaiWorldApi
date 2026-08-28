import { ADMIN_FEATURE_DEFINITIONS, ADMIN_PAGE_DEFINITIONS } from '#shared/admin-page-permissions'
import { recordAudit, requireOwner, updateAdminPermissionsBatch } from '../../utils/db'

function permissionMap(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: `${label}格式不正确` })
  }
  return value as Record<string, unknown>
}

export default defineEventHandler(async (event) => {
  const actor = requireOwner(event)
  const body = await readBody<{
    userIds?: unknown
    permissions?: unknown
    featurePermissions?: unknown
  }>(event)
  if (!Array.isArray(body?.userIds)) {
    throw createError({ statusCode: 400, statusMessage: '用户列表格式不正确' })
  }
  const userIds = [...new Set(body.userIds.map(Number))]
  if (!userIds.length || userIds.length > 100 || userIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw createError({ statusCode: 400, statusMessage: '一次需要选择 1 至 100 位有效用户' })
  }

  const permissions = permissionMap(body.permissions, '页面权限')
  const featurePermissions = permissionMap(body.featurePermissions, '细分权限')
  const hasChanges = ADMIN_PAGE_DEFINITIONS.some((page) => Object.prototype.hasOwnProperty.call(permissions, page.key))
    || ADMIN_FEATURE_DEFINITIONS.some((feature) => Object.prototype.hasOwnProperty.call(featurePermissions, feature.key))
  if (!hasChanges) throw createError({ statusCode: 400, statusMessage: '没有需要修改的权限' })

  const users = updateAdminPermissionsBatch(userIds, permissions, featurePermissions)
  recordAudit(event, actor, `批量更新后台用户权限（${users.length} 人）：${users.map((user) => user.username).join('、')}`)
  return { users }
})
