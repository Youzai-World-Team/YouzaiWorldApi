import {
  assertChatSendAllowed,
  chatIpHash,
  insertChatMessage,
  requireChatContent,
  requireChatName,
  requireChatPlayerSession,
  type ChatRole,
} from '../utils/db'
import { resolveIpLocation } from '../utils/ip-location'
import { verifyTurnstileToken } from '../utils/turnstile'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: string; content?: string; turnstileToken?: string }>(event)
  const ip = (getHeader(event, 'cf-connecting-ip') || getRequestIP(event) || 'unknown').slice(0, 64)
  const ipHash = chatIpHash(ip)

  // 带上有效的聊天会话令牌就以玩家身份发言，昵称取账户里的玩家代号；
  // 没有令牌则是访客，昵称由请求体提供并按公开规则校验。
  const playerToken = (getHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
  const role: ChatRole = playerToken ? 'player' : 'guest'
  const name = playerToken ? requireChatPlayerSession(playerToken) : requireChatName(body?.name)

  const content = requireChatContent(body?.content)

  // 先挡一次，超频或重复内容就不必再消耗一次 siteverify 外呼。
  assertChatSendAllowed(ipHash, content)

  await verifyTurnstileToken(body?.turnstileToken, ip, 'chat')
  const location = await resolveIpLocation(ip, event)

  // 两次 await 期间可能有并发请求落库，落库前复查一次；
  // 复查与写入之间没有 await，node:sqlite 同步执行，不存在竞态。
  assertChatSendAllowed(ipHash, content)
  return insertChatMessage({ name, content, ipHash, location, role })
})
