import {
  getChatTurnstileConfig,
  getChatTurnstileOverrides,
  getTurnstileConfig,
  adminFeatureAllows,
  requireAuth,
} from '../../utils/db'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const user = requireAuth(event)

  const canViewAdmin = adminFeatureAllows(user, 'settings-turnstile-admin', 'view')
  const canViewChat = adminFeatureAllows(user, 'settings-turnstile-chat', 'view')

  const admin = getTurnstileConfig()
  const chat = getChatTurnstileConfig()
  const chatOverrides = getChatTurnstileOverrides()

  return {
    admin: canViewAdmin ? {
      siteKey: admin.siteKey,
      secret: admin.secret,
      hostnames: admin.hostnames,
      secretConfigured: !!admin.secret,
    } : null,
    chat: canViewChat ? {
      siteKey: chat.siteKey,
      secret: chatOverrides.secret,
      hostnames: chat.hostnames,
      secretConfigured: !!chat.secret,
      // 未单独配置时聊天区会复用后台那套，这通常就是
      // 「前端显示通过、发送却提示验证失败」的原因。
      inherited: !chatOverrides.siteKey && !chatOverrides.secret && !chatOverrides.hostnames,
    } : null,
  }
})
