import { recordAudit, requireOwner, updateAdminUser } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const actor = requireOwner(event)
  const userId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(userId) || userId <= 0) throw createError({ statusCode: 400, statusMessage: '用户编号无效' })
  const body = await readBody<{ password?: string; active?: boolean }>(event)
  if (body?.password === undefined && body?.active === undefined) {
    throw createError({ statusCode: 400, statusMessage: '没有需要更新的内容' })
  }
  if (body.password !== undefined && userId === actor.id) {
    throw createError({ statusCode: 400, statusMessage: '请到账户页面修改自己的密码' })
  }
  const user = updateAdminUser(userId, body)
  const actions: string[] = []
  if (body.password !== undefined) actions.push(`重置后台用户密码：${user.username}`)
  if (body.active !== undefined) actions.push(`${user.isActive ? '启用' : '停用'}后台用户：${user.username}`)
  recordAudit(event, actor, actions.join('；'))
  return user
})
