export type AdminPagePermissionLevel = 'hidden' | 'view' | 'edit'

export type AdminFeaturePermissionLevel = AdminPagePermissionLevel

export interface AdminPageDefinition {
  key: string
  label: string
  route: string
  icon: string
  defaultLevel: AdminPagePermissionLevel
  maxNonOwnerLevel?: Exclude<AdminPagePermissionLevel, 'edit'>
}

export interface AdminFeatureDefinition {
  key: string
  label: string
  icon: string
  description: string
  parentKey?: string
  pageKey?: string
  defaultLevel: AdminFeaturePermissionLevel
  maxNonOwnerLevel?: Exclude<AdminFeaturePermissionLevel, 'edit'>
  availableLevels?: AdminFeaturePermissionLevel[]
}

export const ADMIN_PAGE_DEFINITIONS: AdminPageDefinition[] = [
  {
    key: 'dashboard',
    label: '仪表盘',
    route: '/',
    icon: 'dashboard',
    defaultLevel: 'view',
    maxNonOwnerLevel: 'view',
  },
  { key: 'activity', label: '服务器动态', route: '/activity', icon: 'monitoring', defaultLevel: 'edit' },
  { key: 'chat', label: '聊天区', route: '/chat', icon: 'forum', defaultLevel: 'edit' },
  { key: 'donors', label: '捐赠列表', route: '/donors', icon: 'redeem', defaultLevel: 'edit' },
  { key: 'bans', label: '封禁列表', route: '/bans', icon: 'gavel', defaultLevel: 'edit' },
  { key: 'updates', label: '更新服务', route: '/updates', icon: 'system_update', defaultLevel: 'edit' },
  { key: 'game-accounts', label: '游戏账户', route: '/game-accounts', icon: 'manage_accounts', defaultLevel: 'edit' },
  { key: 'game-cosmetics', label: '账户装扮', route: '/game-cosmetics', icon: 'checkroom', defaultLevel: 'edit' },
  { key: 'mail', label: '服内邮件', route: '/mail', icon: 'mail', defaultLevel: 'edit' },
  { key: 'domain-mail', label: '域名邮件', route: '/domain-mail', icon: 'alternate_email', defaultLevel: 'edit' },
  {
    key: 'audit-logs',
    label: '操作记录',
    route: '/audit-logs',
    icon: 'history',
    defaultLevel: 'view',
    maxNonOwnerLevel: 'view',
  },
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

export const ADMIN_FEATURE_DEFINITIONS: AdminFeatureDefinition[] = [
  {
    key: 'account-password',
    label: '账户：修改密码',
    icon: 'lock',
    description: '允许账户修改自己的后台密码。',
    parentKey: 'account',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'account-full-name',
    label: '账户：修改全名',
    icon: 'badge',
    description: '允许账户修改自己的显示名称。',
    parentKey: 'account',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'account-avatar',
    label: '账户：修改头像',
    icon: 'account_circle',
    description: '允许账户上传、移除或恢复自己的头像。',
    parentKey: 'account',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'settings-game-api-key',
    label: '站点设置：游戏 API 密钥',
    icon: 'vpn_key',
    description: '隐藏、查看或修改 Minecraft 模组使用的 API 密钥。',
    parentKey: 'settings',
    pageKey: 'settings',
    defaultLevel: 'hidden',
  },
  {
    key: 'settings-inbound-mail-key',
    label: '站点设置：域名邮件投递密钥',
    icon: 'key',
    description: '隐藏、查看或修改 Cloudflare Email Worker 投递收件时使用的签名密钥。',
    parentKey: 'settings',
    pageKey: 'settings',
    defaultLevel: 'hidden',
  },
  {
    key: 'settings-turnstile-admin',
    label: '站点设置：后台人机验证',
    icon: 'verified_user',
    description: '查看或修改后台登录的人机验证配置。',
    parentKey: 'settings',
    pageKey: 'settings',
    defaultLevel: 'edit',
  },
  {
    key: 'settings-turnstile-chat',
    label: '站点设置：聊天区人机验证',
    icon: 'chat',
    description: '查看或修改官网聊天区的人机验证配置。',
    parentKey: 'settings',
    pageKey: 'settings',
    defaultLevel: 'edit',
  },
]

export const ADMIN_PAGE_KEYS = new Set(ADMIN_PAGE_DEFINITIONS.map((page) => page.key))
export const ADMIN_FEATURE_KEYS = new Set(ADMIN_FEATURE_DEFINITIONS.map((feature) => feature.key))

export function defaultAdminPagePermissions(): Record<string, AdminPagePermissionLevel> {
  return Object.fromEntries(ADMIN_PAGE_DEFINITIONS.map((page) => [page.key, page.defaultLevel]))
}

export function ownerAdminPagePermissions(): Record<string, AdminPagePermissionLevel> {
  return Object.fromEntries(ADMIN_PAGE_DEFINITIONS.map((page) => [page.key, 'edit']))
}

export function defaultAdminFeaturePermissions(): Record<string, AdminFeaturePermissionLevel> {
  return Object.fromEntries(ADMIN_FEATURE_DEFINITIONS.map((feature) => [feature.key, feature.defaultLevel]))
}

export function ownerAdminFeaturePermissions(): Record<string, AdminFeaturePermissionLevel> {
  return Object.fromEntries(ADMIN_FEATURE_DEFINITIONS.map((feature) => [feature.key, 'edit']))
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
