import { getPasswordExpiryPolicy, recordAudit, requireOwner, setPasswordExpiryPolicy } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const user = requireOwner(event)
  const body = await readBody<{ enabled?: boolean; days?: number }>(event)
  const previous = getPasswordExpiryPolicy()
  const policy = setPasswordExpiryPolicy(body?.enabled, body?.days)
  const action = policy.enabled
    ? `设置后台密码有效期为 ${policy.days} 天，提前 10 天提醒`
    : '关闭后台密码有效期'
  if (previous.enabled !== policy.enabled || previous.days !== policy.days) recordAudit(event, user, action)
  return policy
})
