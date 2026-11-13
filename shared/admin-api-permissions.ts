const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function pageKeyForApi(path: string): string | undefined {
  if (path.startsWith('/api/admin/core-announcement')) return 'core-announcement'
  if (path.startsWith('/api/admin/permissions')) return 'permissions'
  if (path.startsWith('/api/admin/users')) return 'admin-users'
  if (path.startsWith('/api/admin/audit-logs')) return 'audit-logs'
  // Must be matched before the generic status endpoint: history retention is
  // managed from Site Settings and uses that page's edit permission.
  if (path.startsWith('/api/admin/status-history')) return 'settings'
  if (path.startsWith('/api/admin/status')) return 'status'
  if (path.startsWith('/api/admin/turnstile')
    || path.startsWith('/api/admin/password-policy')
    || path.startsWith('/api/admin/password-expiry')
    || path.startsWith('/api/admin/mcsm-settings')
    || path.startsWith('/api/auth/game-api-key')
    || path.startsWith('/api/auth/inbound-mail-key')) return 'settings'
  // 游戏统计同步接口使用独立功能权限；它虽然是 POST，但所属页面本身是只读页。
  if (path.replace(/\/+$/, '') === '/api/admin/game-stats/sync') return undefined
  if (path.startsWith('/api/admin/mcsm/')) return 'server-manage'
  if (path.startsWith('/api/admin/game-accounts')
    || path.startsWith('/api/admin/game-account-settings')
    || path.startsWith('/api/admin/game-account-email-preview')
    || path.startsWith('/api/admin/game-account-uuid')) return 'game-accounts'
  if (path.startsWith('/api/admin/game-maps')) return 'game-maps'
  if (path.startsWith('/api/admin/game-stats')) return 'game-stats'
  if (path.startsWith('/api/admin/game-cosmetics')) return 'game-cosmetics'
  if (path.startsWith('/api/admin/game-titles')) return 'game-titles'
  if (path.startsWith('/api/admin/domain-mails')) return 'domain-mail'
  if (path.startsWith('/api/admin/mails')) return 'mail'
  if (path.startsWith('/api/admin/chat')) return 'chat'
  if (path.startsWith('/api/auth/logins')) return 'dashboard'
  if (path.startsWith('/api/activities')) return 'activity'
  if (path.startsWith('/api/donors')) return 'donors'
  if (path.startsWith('/api/bans')) return 'bans'
  if (path.startsWith('/api/updates')) return 'updates'
  if (path.startsWith('/api/downloads')) return 'downloads'
  return undefined
}

export function isReadOperation(path: string, method: string): boolean {
  if (!MUTATING_METHODS.has(method.toUpperCase())) return true
  return path === '/api/admin/game-account-email-preview'
    || path === '/api/admin/game-cosmetics/lookup'
}
