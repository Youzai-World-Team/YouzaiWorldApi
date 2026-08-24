import { recordAudit, requireFeaturePermission, updateTurnstileConfig, type TurnstileScope } from '../../utils/db'

const SCOPES = new Set<TurnstileScope>(['admin', 'chat'])
const SCOPE_LABELS: Record<TurnstileScope, string> = { admin: '后台登录', chat: '聊天区' }

export default defineEventHandler(async (event) => {
  const body = await readBody<{ scope?: string; siteKey?: string; secret?: string; hostnames?: string }>(event)

  const scope = String(body?.scope || '') as TurnstileScope
  if (!SCOPES.has(scope)) {
    throw createError({ statusCode: 400, statusMessage: '配置范围无效' })
  }
  const user = requireFeaturePermission(event, `settings-turnstile-${scope}`, 'edit')

  updateTurnstileConfig(scope, {
    siteKey: body?.siteKey,
    secret: body?.secret,
    hostnames: body?.hostnames,
  })
  recordAudit(event, user, `更新${SCOPE_LABELS[scope]}人机验证配置`)

  return { ok: true }
})
