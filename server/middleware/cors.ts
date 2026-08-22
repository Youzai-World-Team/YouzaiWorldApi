// 官网需要跨源调用的公开聊天接口：发言、玩家登录/登出。
// 其余路径保持只读放行。
const CHAT_WRITE_PATHS = new Set(['/api/chat', '/api/chat/login', '/api/chat/logout'])

export default defineEventHandler((event) => {
  const origin = getHeader(event, 'origin') || ''
  if (origin !== 'https://mcyzw.top') return

  const allowWrite = CHAT_WRITE_PATHS.has(getRequestURL(event).pathname)

  if (handleCors(event, {
    origin: ['https://mcyzw.top'],
    methods: allowWrite ? ['GET', 'HEAD', 'OPTIONS', 'POST'] : ['GET', 'HEAD', 'OPTIONS'],
    // Authorization 用于携带聊天区玩家会话令牌（发言、查询会话、登出）。
    allowHeaders: ['Accept', 'Authorization', 'Content-Type'],
    exposeHeaders: ['Content-Length', 'Content-Type', 'ETag'],
    maxAge: '86400',
  })) return
})
