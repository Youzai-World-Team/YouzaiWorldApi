import { createAdminUser, recordAudit, requireOwner } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const actor = requireOwner(event)
  const body = await readBody<{ username?: string; password?: string }>(event)
  const user = createAdminUser(body?.username, body?.password)
  recordAudit(event, actor, `创建后台用户：${user.username}`)
  return user
})
