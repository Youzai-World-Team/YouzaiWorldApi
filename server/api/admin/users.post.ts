import { createAdminUser, recordAudit, requireOwner } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const actor = requireOwner(event)
  const body = await readBody<{
    username?: string
    fullName?: string
    avatar?: string
    password?: string
    confirmPassword?: string
  }>(event)
  if (String(body?.password ?? '') !== String(body?.confirmPassword ?? '')) {
    throw createError({ statusCode: 400, statusMessage: '两次输入的密码不一致' })
  }
  const user = createAdminUser(body?.username, body?.password, false, {
    fullName: body?.fullName,
    avatar: body?.avatar,
  })
  recordAudit(event, actor, `创建后台用户：${user.username}`)
  return user
})
