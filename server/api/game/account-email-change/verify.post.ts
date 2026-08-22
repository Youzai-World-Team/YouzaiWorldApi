import { getHeader } from 'h3'
import {
  completeGameEmailChange,
  gameAccountWire,
  requireGameApiKey,
  requireGameSession,
} from '../../../utils/db'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const token = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw createError({ statusCode: 401, message: '缺少游戏会话' })

  const account = requireGameSession(token)
  const body = await readBody<any>(event)
  const updated = completeGameEmailChange(
    account,
    body?.session_id ?? body?.sessionId,
    body?.code ?? body?.verification_code,
  )
  return {
    ok: true,
    msg: '邮箱换绑成功',
    account: gameAccountWire(updated),
  }
})
