export type AdminPagePermissionLevel = 'hidden' | 'view' | 'edit'

export type AdminFeaturePermissionLevel = AdminPagePermissionLevel

export interface AdminPageDefinition {
  key: string
  label: string
  route: string
  icon: string
  defaultLevel: AdminPagePermissionLevel
  readOnly?: boolean
  maxNonOwnerLevel?: Exclude<AdminPagePermissionLevel, 'edit'>
}

export interface AdminNavigationPreferences {
  order: string[]
  hidden: string[]
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
    readOnly: true,
    maxNonOwnerLevel: 'view',
  },
  { key: 'activity', label: '服务器动态', route: '/activity', icon: 'monitoring', defaultLevel: 'edit' },
  {
    key: 'status',
    label: '服务器状态',
    route: '/status',
    icon: 'monitor_heart',
    defaultLevel: 'view',
    readOnly: true,
    maxNonOwnerLevel: 'view',
  },
  { key: 'chat', label: '聊天区', route: '/chat', icon: 'forum', defaultLevel: 'edit' },
  { key: 'donors', label: '捐赠列表', route: '/donors', icon: 'redeem', defaultLevel: 'edit' },
  { key: 'bans', label: '封禁列表', route: '/bans', icon: 'gavel', defaultLevel: 'edit' },
  { key: 'updates', label: '更新服务', route: '/updates', icon: 'system_update', defaultLevel: 'edit' },
  { key: 'downloads', label: '下载项目', route: '/downloads', icon: 'download', defaultLevel: 'edit' },
  // 这一页能停服和发送任意后台命令，默认只给「查看」：新管理员先能看控制台，
  // 需要动电源和发命令时再由所有者单独放开到「编辑」。
  { key: 'server-manage', label: '服务器管理', route: '/server-manage', icon: 'dns', defaultLevel: 'view' },
  // 这一页能读写实例目录里的任意文件（含 jar 与启动脚本），默认整页隐藏，
  // 需要时由所有者单独放开。
  { key: 'server-files', label: '服务器文件', route: '/server-files', icon: 'folder', defaultLevel: 'hidden' },
  { key: 'game-accounts', label: '游戏账户', route: '/game-accounts', icon: 'manage_accounts', defaultLevel: 'edit' },
  {
    key: 'game-stats',
    label: '游戏统计',
    route: '/game-stats',
    icon: 'analytics',
    defaultLevel: 'view',
    readOnly: true,
    maxNonOwnerLevel: 'view',
  },
  { key: 'game-cosmetics', label: '账户装扮', route: '/game-cosmetics', icon: 'checkroom', defaultLevel: 'edit' },
  { key: 'game-titles', label: '玩家称号', route: '/game-titles', icon: 'military_tech', defaultLevel: 'edit' },
  { key: 'mail', label: '服内邮件', route: '/mail', icon: 'mail', defaultLevel: 'edit' },
  { key: 'domain-mail', label: '域名邮件', route: '/domain-mail', icon: 'alternate_email', defaultLevel: 'edit' },
  {
    key: 'audit-logs',
    label: '操作记录',
    route: '/audit-logs',
    icon: 'history',
    defaultLevel: 'view',
    readOnly: true,
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

export const ADMIN_NAVIGATION_ORDER = [
  'dashboard',
  'status',
  'activity',
  'server-manage',
  'server-files',
  'game-accounts',
  'game-stats',
  'bans',
  'game-cosmetics',
  'game-titles',
  'chat',
  'mail',
  'domain-mail',
  'donors',
  'downloads',
  'updates',
  'audit-logs',
  'admin-users',
  'permissions',
  'settings',
] as const

const ADMIN_NAVIGATION_KEYS = new Set<string>(ADMIN_NAVIGATION_ORDER)

export function normalizeAdminNavigationPreferences(value: unknown): AdminNavigationPreferences {
  let source = value
  if (typeof source === 'string' && source.trim()) {
    try {
      source = JSON.parse(source)
    } catch {
      source = null
    }
  }
  const record = source && typeof source === 'object'
    ? source as { order?: unknown; hidden?: unknown }
    : {}
  const requestedOrder = Array.isArray(record.order) ? record.order : []
  const requestedHidden = Array.isArray(record.hidden) ? record.hidden : []
  const order: string[] = []
  const seen = new Set<string>()
  for (const value of requestedOrder) {
    const key = typeof value === 'string' ? value : ''
    if (!ADMIN_NAVIGATION_KEYS.has(key) || seen.has(key)) continue
    seen.add(key)
    order.push(key)
  }
  for (const key of ADMIN_NAVIGATION_ORDER) {
    if (!seen.has(key)) order.push(key)
  }
  const hidden = [...new Set(requestedHidden
    .filter((key): key is string => typeof key === 'string' && ADMIN_NAVIGATION_KEYS.has(key)))]
  return { order, hidden }
}

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
    key: 'chat-send',
    label: '聊天区：发布消息',
    icon: 'send',
    description: '允许使用后台账户身份向官网聊天区发布消息。',
    parentKey: 'chat',
    pageKey: 'chat',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'chat-moderate',
    label: '聊天区：管理消息',
    icon: 'delete_sweep',
    description: '允许删除单条消息或清空聊天区。',
    parentKey: 'chat',
    pageKey: 'chat',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'game-accounts-manage',
    label: '游戏账户：管理账户',
    icon: 'manage_accounts',
    description: '允许创建、解锁、重置密码和注销游戏账户。',
    parentKey: 'game-accounts',
    pageKey: 'game-accounts',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'game-accounts-settings',
    label: '游戏账户：修改登录与邮件设置',
    icon: 'settings',
    description: '允许修改登录冷却、注册邮箱验证和 SMTP 配置。',
    parentKey: 'game-accounts',
    pageKey: 'game-accounts',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'game-accounts-email-templates',
    label: '游戏账户：修改验证码邮件模板',
    icon: 'edit_note',
    description: '允许修改注册、找回密码与换绑邮箱的验证码邮件模板。',
    parentKey: 'game-accounts',
    pageKey: 'game-accounts',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'game-stats-sync',
    label: '游戏统计：立即同步数据',
    icon: 'cloud_sync',
    description: '通过 MCSManager 向 Minecraft 服务器发送后台指令，立即触发统计数据上传。',
    parentKey: 'game-stats',
    defaultLevel: 'hidden',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'game-cosmetics-refresh',
    label: '账户装扮：刷新正版档案',
    icon: 'cloud_sync',
    description: '允许绕过缓存重新向 Mojang 查询正版账户外观。',
    parentKey: 'game-cosmetics',
    pageKey: 'game-cosmetics',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'game-titles-catalog',
    label: '玩家称号：管理称号目录',
    icon: 'workspace_premium',
    description: '允许创建、修改、启用和停用称号定义。',
    parentKey: 'game-titles',
    pageKey: 'game-titles',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'game-titles-grants',
    label: '玩家称号：管理玩家授权',
    icon: 'person_edit',
    description: '允许手动给予、回收称号，并修改玩家正在佩戴的称号。',
    parentKey: 'game-titles',
    pageKey: 'game-titles',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'mail-publish',
    label: '服内邮件：发布公告与通知',
    icon: 'outgoing_mail',
    description: '允许通过后台向全体或指定玩家发布服内公告和通知。',
    parentKey: 'mail',
    pageKey: 'mail',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'domain-mail-send',
    label: '域名邮件：发送邮件',
    icon: 'send',
    description: '允许使用后台账户对应的域名邮箱发送邮件。',
    parentKey: 'domain-mail',
    pageKey: 'domain-mail',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'domain-mail-delete',
    label: '域名邮件：删除邮件',
    icon: 'delete',
    description: '允许永久删除收到的域名邮件及其附件。',
    parentKey: 'domain-mail',
    pageKey: 'domain-mail',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'server-files-edit',
    label: '服务器文件：修改文件',
    icon: 'edit_document',
    description: '允许编辑、新建、重命名、复制、移动、压缩和解压实例文件。',
    parentKey: 'server-files',
    pageKey: 'server-files',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'server-files-upload',
    label: '服务器文件：上传文件',
    icon: 'upload_file',
    description: '允许向实例目录上传文件。',
    parentKey: 'server-files',
    pageKey: 'server-files',
    defaultLevel: 'edit',
    availableLevels: ['hidden', 'edit'],
  },
  {
    key: 'server-files-delete',
    label: '服务器文件：删除文件',
    icon: 'delete_forever',
    description: '允许永久删除实例文件和目录。',
    parentKey: 'server-files',
    pageKey: 'server-files',
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
    description: '隐藏、查看或修改「服务器管理」页调用 MCSManager 面板所用的地址与 ApiKey。',
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
    description: '允许创建、恢复与删除实例备份。恢复会覆盖服务器现有文件。',
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
    description: '允许创建、编辑与删除定时任务（定时执行命令、定时启动或停止实例）。',
    parentKey: 'server-manage',
    pageKey: 'server-manage',
    defaultLevel: 'hidden',
  },
  {
    key: 'server-manage-mods',
    label: '服务器管理：Mod 管理',
    icon: 'extension',
    description: '查看、搜索、安装、启用、禁用和删除实例中的 Mod 与插件。',
    parentKey: 'server-manage',
    pageKey: 'server-manage',
    defaultLevel: 'hidden',
    availableLevels: ['hidden', 'view', 'edit'],
  },
  {
    key: 'server-manage-instance-config',
    label: '服务器管理：实例高级设置',
    icon: 'tune',
    description: '查看和修改实例进程配置、终端、Ping、RCON 与自动启动设置。',
    parentKey: 'server-manage',
    pageKey: 'server-manage',
    defaultLevel: 'hidden',
    availableLevels: ['hidden', 'view', 'edit'],
  },
  {
    key: 'server-manage-overview',
    label: '服务器管理：面板概览与日志',
    icon: 'monitoring',
    description: '查看 MCSManager 面板概览和当前实例操作日志。',
    parentKey: 'server-manage',
    pageKey: 'server-manage',
    defaultLevel: 'hidden',
    availableLevels: ['hidden', 'view', 'edit'],
  },
  {
    key: 'server-manage-java',
    label: '服务器管理：Java 环境信息',
    icon: 'coffee',
    description: '查看节点上的 Java 环境列表，不允许在此切换或修改 Java。',
    parentKey: 'server-manage',
    pageKey: 'server-manage',
    defaultLevel: 'hidden',
    availableLevels: ['hidden', 'view'],
  },
  {
    key: 'server-manage-market',
    label: '服务器管理：预设包市场',
    icon: 'storefront',
    description: '查看预设包市场并向实例提交预设包安装任务。',
    parentKey: 'server-manage',
    pageKey: 'server-manage',
    defaultLevel: 'hidden',
    availableLevels: ['hidden', 'view', 'edit'],
  },
]

export const ADMIN_PAGE_KEYS = new Set(ADMIN_PAGE_DEFINITIONS.map((page) => page.key))
export const ADMIN_FEATURE_KEYS = new Set(ADMIN_FEATURE_DEFINITIONS.map((feature) => feature.key))

export function defaultAdminPagePermissions(): Record<string, AdminPagePermissionLevel> {
  return Object.fromEntries(ADMIN_PAGE_DEFINITIONS.map((page) => [page.key, page.defaultLevel]))
}

export function ownerAdminPagePermissions(): Record<string, AdminPagePermissionLevel> {
  return Object.fromEntries(ADMIN_PAGE_DEFINITIONS.map((page) => [page.key, page.readOnly ? 'view' : 'edit']))
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

export function adminPagePermissionNotice(
  pageKey: string | undefined,
  pageLevel: AdminPagePermissionLevel,
  featurePermissions: Record<string, AdminFeaturePermissionLevel> = {},
): { icon: string; text: string } | null {
  const page = ADMIN_PAGE_DEFINITIONS.find((item) => item.key === pageKey)
  if (!page || page.readOnly) return null

  if (pageLevel === 'view') {
    return {
      icon: 'visibility',
      text: '当前账户对此页面仅有查看权限，修改操作已禁用。',
    }
  }
  if (pageLevel !== 'edit') return null

  const features = ADMIN_FEATURE_DEFINITIONS.filter((feature) => feature.pageKey === page.key)
  if (!features.length) return null
  const editableFeatures = features.filter((feature) => featurePermissions[feature.key] === 'edit')
  if (editableFeatures.length === features.length) return null
  if (!editableFeatures.length) {
    return {
      icon: 'visibility',
      text: '当前账户未获授此页面的可编辑功能，修改操作已禁用。',
    }
  }

  const labels = editableFeatures.map((feature) => feature.label.replace(`${page.label}：`, ''))
  return {
    icon: 'edit_note',
    text: `当前账户可编辑此页面的部分功能：${labels.join('、')}。`,
  }
}
