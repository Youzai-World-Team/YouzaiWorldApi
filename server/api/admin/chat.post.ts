import {
  chatIpHash,
  insertChatMessage,
  recordAudit,
  requireAuth,
  requireChatContent,
} from '../../utils/db'
import { resolveIpLocation } from '../../utils/ip-location'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody<{ content?: string }>(event)

  const content = requireChatContent(body?.content)
  // 身份完全由会话推导，不接受客户端传入昵称或头像。
  const name = user.fullName || user.username

  const ip = (getHeader(event, 'cf-connecting-ip') || getRequestIP(event) || 'unknown').slice(0, 64)
  const location = await resolveIpLocation(ip, event)

  // 后台代发不做人机验证与频率限制（已有会话鉴权），改为写入操作记录留痕。
  const message = insertChatMessage({
    name,
    content,
    ipHash: chatIpHash(ip),
    location,
    avatar: user.avatar,
  })
  recordAudit(event, user, '后台发送聊天消息')

  return message
})
