const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function pageKeyForApi(path: string): string | undefined {
  if (path.startsWith('/api/admin/permissions')) return 'permissions'
  if (path.startsWith('/api/admin/users')) return 'admin-users'
  if (path.startsWith('/api/admin/audit-logs')) return 'audit-logs'
  if (path.startsWith('/api/admin/turnstile')
    || path.startsWith('/api/admin/mcsm-settings')
    || path.startsWith('/api/auth/game-api-key')
    || path.startsWith('/api/auth/inbound-mail-key')) return 'settings'
  if (path.startsWith('/api/admin/mcsm/')) return 'server-manage'
  if (path.startsWith('/api/admin/game-accounts')
    || path.startsWith('/api/admin/game-account-settings')
    || path.startsWith('/api/admin/game-account-email-preview')
    || path.startsWith('/api/admin/game-account-uuid')) return 'game-accounts'
  if (path.startsWith('/api/admin/game-cosmetics')) return 'game-cosmetics'
  if (path.startsWith('/api/admin/domain-mails')) return 'domain-mail'
  if (path.startsWith('/api/admin/mails')) return 'mail'
  if (path.startsWith('/api/admin/chat')) return 'chat'
  if (path.startsWith('/api/auth/logins')) return 'dashboard'
  if (path.startsWith('/api/activities')) return 'activity'
  if (path.startsWith('/api/donors')) return 'donors'
  if (path.startsWith('/api/bans')) return 'bans'
  if (path.startsWith('/api/updates')) return 'updates'
  return undefined
}

export function isReadOperation(path: string, method: string): boolean {
  if (!MUTATING_METHODS.has(method.toUpperCase())) return true
  return path === '/api/admin/game-account-email-preview'
    || path === '/api/admin/game-cosmetics/lookup'
}
