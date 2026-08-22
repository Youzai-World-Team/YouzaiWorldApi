// 公开聊天接口需要官网跨源写入，其余路径保持只读放行。
const CHAT_PUBLIC_PATH = '/api/chat'

export default defineEventHandler((event) => {
  const origin = getHeader(event, 'origin') || ''
  if (origin !== 'https://mcyzw.top') return

  const allowChatWrite = getRequestURL(event).pathname === CHAT_PUBLIC_PATH

  if (handleCors(event, {
    origin: ['https://mcyzw.top'],
    methods: allowChatWrite ? ['GET', 'HEAD', 'OPTIONS', 'POST'] : ['GET', 'HEAD', 'OPTIONS'],
    allowHeaders: ['Accept', 'Content-Type'],
    exposeHeaders: ['Content-Length', 'Content-Type', 'ETag'],
    maxAge: '86400',
  })) return
})
