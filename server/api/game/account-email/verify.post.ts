import {
  completeGameRegistration,
  createGameSession,
  gameAccountWire,
  requireGameApiKey,
} from '../../../utils/db'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  const completed = completeGameRegistration(
    body?.session_id ?? body?.sessionId,
    body?.code ?? body?.verification_code,
  )
  return {
    ok: true,
    msg: '注册成功',
    token: completed.startSession ? createGameSession(completed.account.username) : null,
    account: gameAccountWire(completed.account),
  }
})
