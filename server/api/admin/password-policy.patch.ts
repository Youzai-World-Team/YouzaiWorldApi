import { recordAudit, requirePagePermission, setPasswordPolicy } from '../../utils/db'
import { passwordStrengthLabel } from '#shared/password-policy'

export default defineEventHandler(async (event) => {
  const user = requirePagePermission(event, 'settings', 'edit')
  const body = await readBody<{ enabled?: boolean; minimumScore?: number }>(event)
  const policy = setPasswordPolicy(body?.enabled, body?.minimumScore)
  recordAudit(event, user, `更新后台账户密码策略：${policy.enabled ? `最低“${passwordStrengthLabel(policy.minimumScore)}”` : '不强制'}`)
  return policy
})
