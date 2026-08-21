import { deleteAdminUser, listAdminUsers, recordAudit, requireOwner } from '../../../utils/db'

export default defineEventHandler((event) => {
  const actor = requireOwner(event)
  const userId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(userId) || userId <= 0) throw createError({ statusCode: 400, statusMessage: '用户编号无效' })
  const target = listAdminUsers().find((user) => user.id === userId)
  if (!target) throw createError({ statusCode: 404, statusMessage: '后台用户不存在' })
  deleteAdminUser(userId)
  recordAudit(event, actor, `删除后台用户：${target.username}`)
  return { ok: true }
})
