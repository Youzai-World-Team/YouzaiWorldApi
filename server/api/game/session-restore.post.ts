import { gameAccountWire, getGameAccount, getGameAccountSettings, hasActiveGameSession, refreshGameSession, requireGameApiKey, upsertGameAccount } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<{ username?: string; ip?: string }>(event)
  const account = getGameAccount(String(body?.username || ''))
  if (!account?.password) return { restored: false }
  const { sessionTimeout } = getGameAccountSettings()
  const authenticatedAt = Date.parse(account.lastAuthenticatedDate)
  const withinSession = sessionTimeout > 0 && Number.isFinite(authenticatedAt)
    && Date.now() - authenticatedAt < sessionTimeout * 1000
  if (!withinSession || !hasActiveGameSession(account.username)
      || !account.lastIp || account.lastIp !== String(body?.ip || '')) return { restored: false }
  account.lastAuthenticatedDate = new Date().toISOString()
  upsertGameAccount(account)
  const token = refreshGameSession(account.username, null)
  return { restored: true, token, account: gameAccountWire(account) }
})
