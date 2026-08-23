export type AdminPagePermissionLevel = 'hidden' | 'view' | 'edit'

export interface AdminPageDefinition {
  key: string
  label: string
  route: string
  icon: string
  defaultLevel: AdminPagePermissionLevel
  maxNonOwnerLevel?: Exclude<AdminPagePermissionLevel, 'edit'>
}

export const ADMIN_PAGE_DEFINITIONS: AdminPageDefinition[] = [
  { key: 'dashboard', label: '仪表盘', route: '/', icon: 'dashboard', defaultLevel: 'edit' },
  { key: 'activity', label: '服务器动态', route: '/activity', icon: 'monitoring', defaultLevel: 'edit' },
  { key: 'chat', label: '聊天区', route: '/chat', icon: 'forum', defaultLevel: 'edit' },
  { key: 'donors', label: '捐赠列表', route: '/donors', icon: 'redeem', defaultLevel: 'edit' },
  { key: 'bans', label: '封禁列表', route: '/bans', icon: 'gavel', defaultLevel: 'edit' },
  { key: 'updates', label: '更新服务', route: '/updates', icon: 'system_update', defaultLevel: 'edit' },
  { key: 'game-accounts', label: '游戏账户', route: '/game-accounts', icon: 'manage_accounts', defaultLevel: 'edit' },
  { key: 'game-cosmetics', label: '账户装扮', route: '/game-cosmetics', icon: 'checkroom', defaultLevel: 'edit' },
  { key: 'mail', label: '服内邮件', route: '/mail', icon: 'mail', defaultLevel: 'edit' },
  { key: 'audit-logs', label: '操作记录', route: '/audit-logs', icon: 'history', defaultLevel: 'edit' },
  { key: 'settings', label: '站点设置', route: '/settings', icon: 'settings', defaultLevel: 'view' },
  {
    key: 'admin-users',
    label: '后台用户',
    route: '/admin-users',
    icon: 'manage_accounts',
    defaultLevel: 'hidden',
    maxNonOwnerLevel: 'hidden',
  },
  {
    key: 'permissions',
    label: '权限管理',
    route: '/permissions',
    icon: 'admin_panel_settings',
    defaultLevel: 'hidden',
    maxNonOwnerLevel: 'view',
  },
]

export const ADMIN_PAGE_KEYS = new Set(ADMIN_PAGE_DEFINITIONS.map((page) => page.key))

export function defaultAdminPagePermissions(): Record<string, AdminPagePermissionLevel> {
  return Object.fromEntries(ADMIN_PAGE_DEFINITIONS.map((page) => [page.key, page.defaultLevel]))
}

export function ownerAdminPagePermissions(): Record<string, AdminPagePermissionLevel> {
  return Object.fromEntries(ADMIN_PAGE_DEFINITIONS.map((page) => [page.key, 'edit']))
}

export function adminPageKeyForPath(path: string): string | undefined {
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path
  if (normalized === '/game-account-email-templates') return 'game-accounts'
  return ADMIN_PAGE_DEFINITIONS.find((page) => page.route === normalized)?.key
}

export function firstVisibleAdminRoute(permissions: Record<string, AdminPagePermissionLevel>): string {
  return ADMIN_PAGE_DEFINITIONS.find((page) => permissions[page.key] !== 'hidden')?.route || '/account'
}

export function permissionAllows(
  actual: AdminPagePermissionLevel | undefined,
  required: Exclude<AdminPagePermissionLevel, 'hidden'>,
): boolean {
  const rank: Record<AdminPagePermissionLevel, number> = { hidden: 0, view: 1, edit: 2 }
  return rank[actual || 'hidden'] >= rank[required]
}
