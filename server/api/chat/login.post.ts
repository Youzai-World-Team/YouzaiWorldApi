import {
  assertChatLoginAllowed,
  clearChatLoginFailures,
  createChatPlayerSession,
  recordChatLoginFailure,
  verifyChatPlayerLogin,
} from '../../utils/db'
import { verifyTurnstileChat } from '../../utils/turnstile'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ username?: string; password?: string; turnstileToken?: string }>(event)
  const ip = (getHeader(event, 'cf-connecting-ip') || getRequestIP(event) || 'unknown').slice(0, 64)

  assertChatLoginAllowed(ip)
  await verifyTurnstileChat(body?.turnstileToken, ip, 'chat-login')

  let username: string
  try {
    username = verifyChatPlayerLogin(body?.username, body?.password)
  } catch (error) {
    // 只按 IP 累计失败次数，不触碰游戏账户的锁定计数，
    // 以免有人拿别人的玩家代号在网页上乱试、把对方锁在游戏外。
    recordChatLoginFailure(ip)
    throw error
  }

  clearChatLoginFailures(ip)
  const session = createChatPlayerSession(username)
  return { username, token: session.token, expiresAt: session.expiresAt }
})
