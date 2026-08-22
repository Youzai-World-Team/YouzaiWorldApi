import { deleteChatPlayerSession } from '../../utils/db'

export default defineEventHandler((event) => {
  const token = (getHeader(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
  // 幂等：令牌无效或已过期也返回成功，前端可以放心清掉本地状态。
  deleteChatPlayerSession(token)
  return { ok: true }
})
