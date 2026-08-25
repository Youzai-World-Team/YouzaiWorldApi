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
  // 这一页能停服和发送任意后台命令，默认只给「查看」：新管理员先能看控制台，
  // 需要动电源和发命令时再由所有者单独放开到「编辑」。
  { key: 'server-manage', label: '服务器管理', route: '/server-manage', icon: 'dns', defaultLevel: 'view' },
  // 这一页能读写实例目录里的任意文件（含 jar 与启动脚本），默认整页隐藏，
  // 需要时由所有者单独放开。
  { key: 'server-files', label: '服务器文件', route: '/server-files', icon: 'folder', defaultLevel: 'hidden' },
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
  {
    key: 'settings-mcsm',
    label: '站点设置：MCSM 面板凭据',
    icon: 'lan',
    description: '隐藏、查看或修改「服务器管理」页调用 MCSManager 面板所用的地址、ApiKey 与备份目录。',
    parentKey: 'settings',
    pageKey: 'settings',
    defaultLevel: 'hidden',
  },
  {
    key: 'server-manage-power',
    label: '服务器管理：电源操作',
    icon: 'power_settings_new',
    description: '允许启动、停止、重启与强制结束实例进程。会踢出所有在线玩家。',
    parentKey: 'server-manage',
    pageKey: 'server-manage',
    defaultLevel: 'hidden',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'server-manage-command',
    label: '服务器管理：发送命令',
    icon: 'terminal',
    description: '允许向实例控制台发送任意命令（等同于服务器后台的 OP 权限）。',
    parentKey: 'server-manage',
    pageKey: 'server-manage',
    defaultLevel: 'hidden',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'server-manage-backup',
    label: '服务器管理：备份管理',
    icon: 'backup',
    description: '允许创建、下载、恢复与删除实例备份。恢复会覆盖服务器现有文件。',
    parentKey: 'server-manage',
    pageKey: 'server-manage',
    defaultLevel: 'hidden',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'server-manage-properties',
    label: '服务器管理：服务器设置',
    icon: 'tune',
    description: '允许修改 server.properties，包括白名单、正版验证、难度与游戏模式等。',
    parentKey: 'server-manage',
    pageKey: 'server-manage',
    defaultLevel: 'hidden',
  },
  {
    key: 'server-manage-schedule',
    label: '服务器管理：计划任务',
    icon: 'schedule',
    description: '允许创建与删除定时任务（定时执行命令、定时启动或停止实例）。',
    parentKey: 'server-manage',
    pageKey: 'server-manage',
    defaultLevel: 'hidden',
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
  // 独立预览页是「服务器文件」的子路由，权限必须跟着主页面走，
  // 否则它会因为匹配不到页面定义而绕过页面权限检查。
  if (normalized.startsWith('/server-files/')) return 'server-files'
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
