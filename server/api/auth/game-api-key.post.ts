import { recordAudit, requirePagePermission, setGameApiKey } from '../../utils/db'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const user = requirePagePermission(event, 'settings', 'edit')
  const body = await readBody<{ gameApiKey?: string }>(event)
  const gameApiKey = setGameApiKey(body?.gameApiKey)
  recordAudit(event, user, '修改游戏 API 密钥')
  return { gameApiKey }
})
