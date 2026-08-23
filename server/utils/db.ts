import { DatabaseSync } from 'node:sqlite'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { mkdirSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { getCookie, getHeader, createError, type H3Event } from 'h3'
import { offlinePlayerUuid, requireEmailAddress, requireGameUsername } from './game-input'
import type { MailAction, MailAttachment, MailTargetSpec, MailType } from './game-input'
import {
  cloneVerificationEmailTemplates,
  DEFAULT_VERIFICATION_EMAIL_TEMPLATES,
  resolveVerificationEmailTemplate,
  VERIFICATION_EMAIL_TEMPLATE_KINDS,
  type VerificationEmailTemplates,
} from './email-templates'
import {
  buildVerificationEmailTemplateSource,
  VERIFICATION_EMAIL_LOGO_URL,
} from './email-template-renderer'
import {
  ADMIN_PAGE_DEFINITIONS,
  ADMIN_PAGE_KEYS,
  defaultAdminPagePermissions,
  ownerAdminPagePermissions,
  permissionAllows,
  type AdminPagePermissionLevel,
} from '../../shared/admin-page-permissions'

const dataDir = path.resolve(process.cwd(), 'server/data')
mkdirSync(dataDir, { recursive: true })
mkdirSync(path.join(dataDir, 'uploads'), { recursive: true })

const db = new DatabaseSync(path.join(dataDir, 'database.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    time INTEGER NOT NULL,
    user_id INTEGER
  );
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '',
    full_name TEXT NOT NULL DEFAULT '',
    is_owner INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_page_permissions (
    user_id INTEGER NOT NULL,
    page_key TEXT NOT NULL,
    level TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, page_key)
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    ip TEXT NOT NULL,
    time INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT,
    time INTEGER,
    username TEXT NOT NULL DEFAULT '',
    browser TEXT NOT NULL DEFAULT '',
    os TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    type TEXT,
    date TEXT,
    content TEXT
  );
  CREATE TABLE IF NOT EXISTS donors (
    id TEXT PRIMARY KEY,
    avatar TEXT,
    name TEXT,
    intro TEXT,
    amount REAL
  );
  CREATE TABLE IF NOT EXISTS bans (
    id TEXT PRIMARY KEY,
    player TEXT,
    ban_time TEXT,
    unban_time TEXT,
    reason TEXT
  );
  CREATE TABLE IF NOT EXISTS updates (
    id TEXT PRIMARY KEY,
    key TEXT,
    name TEXT,
    latest_version TEXT,
    type TEXT,
    forced_update INTEGER,
    release_date TEXT,
    release_time TEXT,
    changelog TEXT
  );
  CREATE TABLE IF NOT EXISTS game_accounts (
    username_lower TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    uuid TEXT,
    email TEXT,
    password TEXT NOT NULL DEFAULT '',
    last_ip TEXT NOT NULL DEFAULT '',
    last_login_ip TEXT NOT NULL DEFAULT '',
    last_authenticated_date TEXT,
    registration_date TEXT,
    login_tries INTEGER NOT NULL DEFAULT 0,
    last_kicked_date TEXT,
    last_position TEXT,
    in_place_respawn_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_sessions (
    token TEXT PRIMARY KEY,
    username_lower TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS game_registration_sessions (
    id_hash TEXT PRIMARY KEY,
    username_lower TEXT NOT NULL,
    username TEXT NOT NULL,
    uuid TEXT,
    email TEXT,
    password_hash TEXT NOT NULL,
    last_ip TEXT NOT NULL DEFAULT '',
    last_login_ip TEXT NOT NULL DEFAULT '',
    last_authenticated_date TEXT NOT NULL,
    registration_date TEXT NOT NULL,
    login_tries INTEGER NOT NULL DEFAULT 0,
    last_kicked_date TEXT NOT NULL,
    last_position TEXT,
    in_place_respawn_count INTEGER NOT NULL DEFAULT 0,
    start_session INTEGER NOT NULL DEFAULT 0,
    verification_code_hash TEXT,
    code_expires_at INTEGER,
    resend_after INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS game_registration_sessions_username_idx
    ON game_registration_sessions (username_lower);
  CREATE INDEX IF NOT EXISTS game_registration_sessions_expires_idx
    ON game_registration_sessions (expires_at);
  CREATE TABLE IF NOT EXISTS game_password_reset_sessions (
    id_hash TEXT PRIMARY KEY,
    username_lower TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    verification_code_hash TEXT NOT NULL,
    code_expires_at INTEGER NOT NULL,
    resend_after INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS game_password_reset_sessions_expires_idx
    ON game_password_reset_sessions (expires_at);
  CREATE TABLE IF NOT EXISTS game_email_change_sessions (
    id_hash TEXT PRIMARY KEY,
    username_lower TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    verification_code_hash TEXT NOT NULL,
    code_expires_at INTEGER NOT NULL,
    resend_after INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS game_email_change_sessions_expires_idx
    ON game_email_change_sessions (expires_at);
  CREATE TABLE IF NOT EXISTS game_cosmetics (
    uuid TEXT NOT NULL,
    slot TEXT NOT NULL,
    data BLOB NOT NULL,
    sha256 TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (uuid, slot)
  );
  CREATE TABLE IF NOT EXISTS mojang_profiles (
    username_lower TEXT PRIMARY KEY,
    username TEXT NOT NULL DEFAULT '',
    profile_uuid TEXT,
    skin_hash TEXT NOT NULL DEFAULT '',
    cape_hash TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    checked_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_mails (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    sender TEXT NOT NULL,
    targets TEXT NOT NULL DEFAULT '[]',
    scope_summary TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    created_time INTEGER NOT NULL,
    expire_time INTEGER,
    claimed INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    attachments TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS game_mails_expire_idx ON game_mails (expire_time);
  CREATE TABLE IF NOT EXISTS game_mail_refs (
    mail_id TEXT NOT NULL,
    player_uuid TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    starred INTEGER NOT NULL DEFAULT 0,
    claimed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (mail_id, player_uuid)
  );
  CREATE INDEX IF NOT EXISTS game_mail_refs_player_idx ON game_mail_refs (player_uuid);
  CREATE TABLE IF NOT EXISTS api_request_nonces (
    nonce TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_login_rate_limits (
    rate_key TEXT PRIMARY KEY,
    window_started INTEGER NOT NULL,
    attempts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'guest',
    ip_hash TEXT NOT NULL,
    ip_location TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chat_messages_created_idx ON chat_messages (created_at);
  CREATE INDEX IF NOT EXISTS chat_messages_ip_idx ON chat_messages (ip_hash, created_at);
  CREATE TABLE IF NOT EXISTS chat_player_sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chat_player_sessions_expires_idx ON chat_player_sessions (expires_at);
  CREATE TABLE IF NOT EXISTS chat_login_rate_limits (
    rate_key TEXT PRIMARY KEY,
    window_started INTEGER NOT NULL,
    attempts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ip_locations (
    ip_hash TEXT PRIMARY KEY,
    location TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)

const adminUserColumns = db.prepare('PRAGMA table_info(admin_users)').all() as { name?: string }[]
if (!adminUserColumns.some((column) => column.name === 'avatar')) {
  try {
    db.exec("ALTER TABLE admin_users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''")
  } catch (error) {
    const migratedColumns = db.prepare('PRAGMA table_info(admin_users)').all() as { name?: string }[]
    if (!migratedColumns.some((column) => column.name === 'avatar')) throw error
  }
}
if (!adminUserColumns.some((column) => column.name === 'full_name')) {
  try {
    db.exec("ALTER TABLE admin_users ADD COLUMN full_name TEXT NOT NULL DEFAULT ''")
  } catch (error) {
    const migratedColumns = db.prepare('PRAGMA table_info(admin_users)').all() as { name?: string }[]
    if (!migratedColumns.some((column) => column.name === 'full_name')) throw error
  }
}

const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as { name?: string }[]
if (!sessionColumns.some((column) => column.name === 'user_id')) {
  try {
    db.exec('ALTER TABLE sessions ADD COLUMN user_id INTEGER')
  } catch (error) {
    const migratedColumns = db.prepare('PRAGMA table_info(sessions)').all() as { name?: string }[]
    if (!migratedColumns.some((column) => column.name === 'user_id')) throw error
  }
}

const loginHistoryColumns = db.prepare('PRAGMA table_info(login_history)').all() as { name?: string }[]
for (const column of ['username', 'browser', 'os', 'device']) {
  if (loginHistoryColumns.some((item) => item.name === column)) continue
  try {
    db.exec(`ALTER TABLE login_history ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`)
  } catch (error) {
    // 多进程同时启动时，允许另一进程已经先完成同一迁移。
    const migratedColumns = db.prepare('PRAGMA table_info(login_history)').all() as { name?: string }[]
    if (!migratedColumns.some((item) => item.name === column)) throw error
  }
}

// 为现有数据库补充历史登录 IP 字段，并用尚未清除的旧 last_ip 数据做一次回填。
const gameAccountColumns = db.prepare('PRAGMA table_info(game_accounts)').all() as { name?: string }[]
if (!gameAccountColumns.some((column) => column.name === 'last_login_ip')) {
  try {
    db.exec("ALTER TABLE game_accounts ADD COLUMN last_login_ip TEXT NOT NULL DEFAULT ''")
  } catch (error) {
    // 多进程同时启动时，允许另一进程已经先完成同一迁移。
    const migratedColumns = db.prepare('PRAGMA table_info(game_accounts)').all() as { name?: string }[]
    if (!migratedColumns.some((column) => column.name === 'last_login_ip')) throw error
  }
  db.exec("UPDATE game_accounts SET last_login_ip = last_ip WHERE last_ip <> ''")
}
if (!gameAccountColumns.some((column) => column.name === 'email')) {
  try {
    db.exec('ALTER TABLE game_accounts ADD COLUMN email TEXT')
  } catch (error) {
    const migratedColumns = db.prepare('PRAGMA table_info(game_accounts)').all() as { name?: string }[]
    if (!migratedColumns.some((column) => column.name === 'email')) throw error
  }
}

const gameAccountEmailIndex = db.prepare(`
  SELECT 1 FROM sqlite_master
  WHERE type = 'index' AND name = 'game_accounts_email_unique_idx'
`).get()
if (!gameAccountEmailIndex) {
  // 历史版本允许重复邮箱；迁移时保留最早写入的账户记录，并释放其余重复绑定。
  db.exec(`
    UPDATE game_accounts
    SET email = lower(trim(email))
    WHERE email IS NOT NULL;

    UPDATE game_accounts
    SET email = NULL
    WHERE email = '';

    UPDATE game_accounts
    SET email = NULL
    WHERE email IS NOT NULL
      AND rowid NOT IN (
        SELECT MIN(rowid)
        FROM game_accounts
        WHERE email IS NOT NULL
        GROUP BY email COLLATE NOCASE
      );

    CREATE UNIQUE INDEX IF NOT EXISTS game_accounts_email_unique_idx
      ON game_accounts (email COLLATE NOCASE)
      WHERE email IS NOT NULL;
  `)
}

// 后台/玩家身份发言需要保存头像与角色标记；访客两者都是默认值，
// 由官网按昵称生成像素头像且不显示标记。
const chatMessageColumns = db.prepare('PRAGMA table_info(chat_messages)').all() as { name?: string }[]
for (const [column, definition] of [
  ['avatar', "TEXT NOT NULL DEFAULT ''"],
  ['role', "TEXT NOT NULL DEFAULT 'guest'"],
] as const) {
  if (chatMessageColumns.some((item) => item.name === column)) continue
  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN ${column} ${definition}`)
  } catch (error) {
    // 多进程同时启动时，允许另一进程已经先完成同一迁移。
    const migratedColumns = db.prepare('PRAGMA table_info(chat_messages)').all() as { name?: string }[]
    if (!migratedColumns.some((item) => item.name === column)) throw error
  }
  // role 取代了早期的布尔列 is_admin，迁移时把既有管理员消息标记搬过来。
  if (column === 'role' && chatMessageColumns.some((item) => item.name === 'is_admin')) {
    db.exec("UPDATE chat_messages SET role = 'admin' WHERE is_admin = 1")
  }
}

const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const GAME_REQUEST_MAX_SKEW_SECONDS = 300
const GAME_REQUEST_NONCE_TTL_MS = 10 * 60 * 1000
const GAME_REGISTRATION_SESSION_TTL_MS = 15 * 60 * 1000
const GAME_EMAIL_CODE_TTL_MS = 10 * 60 * 1000
const GAME_EMAIL_RESEND_DELAY_MS = 60 * 1000
const GAME_EMAIL_MAX_ATTEMPTS = 5
const GAME_PASSWORD_RESET_SESSION_TTL_MS = 10 * 60 * 1000
const GAME_EMAIL_CHANGE_SESSION_TTL_MS = 10 * 60 * 1000
const GAME_API_KEY_ENV = 'YZWC_GAME_API_KEY'
const GAME_API_KEY_SETTING = 'game_api.key'
const ADMIN_PASSWORD_ENV = 'YZWC_ADMIN_PASSWORD'
const ADMIN_USERNAME_ENV = 'YZWC_ADMIN_USERNAME'
const ADMIN_ENTRY_ENV = 'YZWC_ADMIN_ENTRY'
const ADMIN_PASSWORD_SETTING = 'admin.password_hash'
const ADMIN_ENTRY_SETTING = 'entry'
const GAME_EMAIL_VERIFICATION_SETTING = 'game_account.email_verification_required'
const SMTP_HOST_SETTING = 'game_account.smtp.host'
const SMTP_PORT_SETTING = 'game_account.smtp.port'
const SMTP_SECURITY_SETTING = 'game_account.smtp.security'
const SMTP_USERNAME_SETTING = 'game_account.smtp.username'
const SMTP_PASSWORD_SETTING = 'game_account.smtp.password'
const SMTP_FROM_ADDRESS_SETTING = 'game_account.smtp.from_address'
const SMTP_FROM_NAME_SETTING = 'game_account.smtp.from_name'
const EMAIL_TEMPLATES_SETTING = 'game_account.email_templates'
const TURNSTILE_SITE_KEY_SETTING = 'turnstile.site_key'
const TURNSTILE_SECRET_SETTING = 'turnstile.secret'
const TURNSTILE_HOSTNAMES_SETTING = 'turnstile.hostnames'
const TURNSTILE_SITE_KEY_ENV = 'NUXT_PUBLIC_TURNSTILE_SITE_KEY'
const TURNSTILE_SECRET_ENV = 'TURNSTILE_SECRET'
const TURNSTILE_HOSTNAMES_ENV = 'TURNSTILE_HOSTNAMES'
const TURNSTILE_CHAT_SITE_KEY_SETTING = 'turnstile.chat_site_key'
const TURNSTILE_CHAT_SECRET_SETTING = 'turnstile.chat_secret'
const TURNSTILE_CHAT_HOSTNAMES_SETTING = 'turnstile.chat_hostnames'
const TURNSTILE_CHAT_SITE_KEY_ENV = 'TURNSTILE_CHAT_SITE_KEY'
const TURNSTILE_CHAT_SECRET_ENV = 'TURNSTILE_CHAT_SECRET'
const TURNSTILE_CHAT_HOSTNAMES_ENV = 'TURNSTILE_CHAT_HOSTNAMES'
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000
const LOGIN_RATE_MAX_ATTEMPTS = 5
const CHAT_NAME_MAX = 16
const CHAT_CONTENT_MAX = 200
const CHAT_RATE_WINDOW_MS = 60 * 1000
const CHAT_RATE_MAX_MESSAGES = 5
const CHAT_HISTORY_LIMIT = 200
const CHAT_RETAINED_ROWS = 500
const CHAT_NAME_RE = /^[一-龥A-Za-z0-9_-]{2,16}$/
const CHAT_PLAYER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CHAT_LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000
const CHAT_LOGIN_RATE_MAX_ATTEMPTS = 5
const IP_LOCATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
// 正版档案缓存：Mojang 名称查询有速率限制，命中缓存的账户不再外呼。
const MOJANG_PROFILE_TTL_MS = 6 * 60 * 60 * 1000
// 查询失败（超时、限流）只短暂缓存，否则一次网络抖动会把账户压住 6 小时。
const MOJANG_ERROR_TTL_MS = 5 * 60 * 1000
const ADMIN_ENTRY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{11,63}$/
const ADMIN_AVATAR_RE = /^\/(?:favicon\.ico|api\/uploads\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|gif|avif))$/
const RESERVED_ADMIN_ENTRIES = new Set([
  'login', 'account', 'activity', 'donors', 'bans', 'updates', 'game-accounts',
  'game-cosmetics', 'game-account-email-templates',
  'admin-users', 'audit-logs', 'chat', 'mail', 'settings', 'permissions', 'api', '_nuxt', '_ipx', 'favicon', '__nuxt_error',
])

export const ADMIN_COOKIE_NAME = '__Host-yzwc_admin'
const ADMIN_USER_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/
const DEFAULT_ADMIN_AVATAR = '/favicon.ico'

function all(sql: string, ...params: any[]) {
  return db.prepare(sql).all(...params) as Record<string, unknown>[]
}

function get(sql: string, ...params: any[]) {
  return db.prepare(sql).get(...params) as Record<string, unknown> | undefined
}

function run(sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params)
}

export function getSetting(key: string): string | undefined {
  return get('SELECT value FROM settings WHERE key = ?', key)?.value as string | undefined
}

export function setSetting(key: string, value: string) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
}

export function deleteSetting(key: string) {
  run('DELETE FROM settings WHERE key = ?', key)
}

export interface TurnstileConfig {
  siteKey: string
  secret: string
  hostnames: string
}

function requireTurnstileValue(value: unknown, label: string, maxLength: number): string {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > maxLength || /\s/.test(normalized)) {
    throw createError({ statusCode: 400, statusMessage: `${label}不能为空且不能包含空白字符` })
  }
  return normalized
}

function requireTurnstileHostnames(value: unknown): string {
  const hostnames = String(value ?? '')
    .split(',')
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean)
  if (hostnames.length === 0 || hostnames.length > 20) {
    throw createError({ statusCode: 400, statusMessage: 'Turnstile 允许域名至少填写一个，最多填写 20 个' })
  }
  const unique = [...new Set(hostnames)]
  for (const hostname of unique) {
    if (hostname.length > 253 || (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)
      && hostname !== '::1')) {
      throw createError({ statusCode: 400, statusMessage: `Turnstile 允许域名无效：${hostname}` })
    }
  }
  return unique.join(',')
}

export function getTurnstileConfig(): TurnstileConfig {
  return {
    siteKey: getSetting(TURNSTILE_SITE_KEY_SETTING) || process.env[TURNSTILE_SITE_KEY_ENV]?.trim() || '',
    secret: getSetting(TURNSTILE_SECRET_SETTING) || process.env[TURNSTILE_SECRET_ENV]?.trim() || '',
    hostnames: getSetting(TURNSTILE_HOSTNAMES_SETTING) || process.env[TURNSTILE_HOSTNAMES_ENV]?.trim() || '',
  }
}

export function getPublicTurnstileConfig() {
  const config = getTurnstileConfig()
  return { siteKey: config.siteKey, hostnames: config.hostnames }
}

/**
 * 聊天区使用独立的一套 Turnstile 凭据：它的 widget 跑在主站域名下，
 * 而后台登录那套 widget 只允许 api 域名，两者不能混用
 * （否则 siteverify 回传的 hostname 过不了允许域名校验）。
 * 未单独配置时回退到后台那一套，方便渐进迁移。
 */
export function getChatTurnstileConfig(): TurnstileConfig {
  const fallback = getTurnstileConfig()
  return {
    siteKey: getSetting(TURNSTILE_CHAT_SITE_KEY_SETTING)
      || process.env[TURNSTILE_CHAT_SITE_KEY_ENV]?.trim() || fallback.siteKey,
    secret: getSetting(TURNSTILE_CHAT_SECRET_SETTING)
      || process.env[TURNSTILE_CHAT_SECRET_ENV]?.trim() || fallback.secret,
    hostnames: getSetting(TURNSTILE_CHAT_HOSTNAMES_SETTING)
      || process.env[TURNSTILE_CHAT_HOSTNAMES_ENV]?.trim() || fallback.hostnames,
  }
}

/** 只下发站点密钥；站点密钥本身是公开信息，服务端密钥绝不出网。 */
export function getPublicChatTurnstileConfig() {
  return { siteKey: getChatTurnstileConfig().siteKey }
}

/** 聊天区自己显式配置的部分（不回退到后台那套），用于后台界面区分「独立配置」与「继承」。 */
export function getChatTurnstileOverrides(): TurnstileConfig {
  return {
    siteKey: getSetting(TURNSTILE_CHAT_SITE_KEY_SETTING) || process.env[TURNSTILE_CHAT_SITE_KEY_ENV]?.trim() || '',
    secret: getSetting(TURNSTILE_CHAT_SECRET_SETTING) || process.env[TURNSTILE_CHAT_SECRET_ENV]?.trim() || '',
    hostnames: getSetting(TURNSTILE_CHAT_HOSTNAMES_SETTING) || process.env[TURNSTILE_CHAT_HOSTNAMES_ENV]?.trim() || '',
  }
}

/** admin：后台登录 widget（只允许 api 域名）；chat：官网聊天区 widget（主站域名）。 */
export type TurnstileScope = 'admin' | 'chat'

const TURNSTILE_SETTING_KEYS: Record<TurnstileScope, { siteKey: string; secret: string; hostnames: string }> = {
  admin: {
    siteKey: TURNSTILE_SITE_KEY_SETTING,
    secret: TURNSTILE_SECRET_SETTING,
    hostnames: TURNSTILE_HOSTNAMES_SETTING,
  },
  chat: {
    siteKey: TURNSTILE_CHAT_SITE_KEY_SETTING,
    secret: TURNSTILE_CHAT_SECRET_SETTING,
    hostnames: TURNSTILE_CHAT_HOSTNAMES_SETTING,
  },
}

const TURNSTILE_SCOPE_LABELS: Record<TurnstileScope, string> = {
  admin: '后台登录',
  chat: '聊天区',
}

/**
 * 更新某一套 Turnstile 凭据并持久化到数据库设置（优先于环境变量）。
 * 服务端密钥留空表示沿用已有的那一份，方便只改域名而不必重新粘贴密钥。
 */
export function updateTurnstileConfig(
  scope: TurnstileScope,
  input: { siteKey?: unknown; secret?: unknown; hostnames?: unknown },
): void {
  const keys = TURNSTILE_SETTING_KEYS[scope]
  const label = TURNSTILE_SCOPE_LABELS[scope]

  const siteKey = requireTurnstileValue(input.siteKey, `${label} Turnstile 站点密钥`, 256)
  const hostnames = requireTurnstileHostnames(input.hostnames)

  // 取「本套自己的」已有密钥：聊天区必须用 overrides，否则留空提交会把
  // 后台那套的密钥抄进聊天区设置里，和聊天区站点密钥对不上。
  const existingSecret = scope === 'chat' ? getChatTurnstileOverrides().secret : getTurnstileConfig().secret
  const providedSecret = String(input.secret ?? '').trim()
  const secret = providedSecret
    ? requireTurnstileValue(providedSecret, `${label} Turnstile 服务端密钥`, 512)
    : existingSecret
  if (!secret) {
    throw createError({ statusCode: 400, statusMessage: `首次配置${label} Turnstile 时必须填写服务端密钥` })
  }

  setSetting(keys.siteKey, siteKey)
  setSetting(keys.secret, secret)
  setSetting(keys.hostnames, hostnames)
}

export function setTurnstileConfig(siteKeyValue: unknown, secretValue: unknown, hostnamesValue: unknown): void {
  const siteKey = requireTurnstileValue(siteKeyValue, 'Turnstile 站点密钥', 256)
  const secret = requireTurnstileValue(secretValue, 'Turnstile 服务端密钥', 512)
  const hostnames = requireTurnstileHostnames(hostnamesValue)
  setSetting(TURNSTILE_SITE_KEY_SETTING, siteKey)
  setSetting(TURNSTILE_SECRET_SETTING, secret)
  setSetting(TURNSTILE_HOSTNAMES_SETTING, hostnames)
}

function requireGameApiKeyValue(value: unknown): string {
  const key = String(value ?? '').trim()
  if (key.length < 32 || key.length > 512 || /\s/.test(key)) {
    throw createError({ statusCode: 400, statusMessage: '游戏 API 密钥长度需要为 32 至 512 位且不能包含空白字符' })
  }
  return key
}

/** 返回数据库中配置的密钥；未配置时兼容使用环境变量。 */
export function getGameApiKey(): string {
  return getSetting(GAME_API_KEY_SETTING)?.trim() || process.env[GAME_API_KEY_ENV]?.trim() || ''
}

export function setGameApiKey(value: unknown): string {
  const key = requireGameApiKeyValue(value)
  setSetting(GAME_API_KEY_SETTING, key)
  return key
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface AdminUser {
  id: number
  username: string
  avatar: string
  fullName: string
  isOwner: boolean
  isActive: boolean
  createdAt: number
  permissions: Record<string, AdminPagePermissionLevel>
}

function getAdminPagePermissions(userId: number, isOwner: boolean): Record<string, AdminPagePermissionLevel> {
  if (isOwner) return ownerAdminPagePermissions()
  const permissions = defaultAdminPagePermissions()
  for (const row of all('SELECT page_key, level FROM admin_page_permissions WHERE user_id = ?', userId)) {
    const key = String(row.page_key ?? '')
    const level = String(row.level ?? '') as AdminPagePermissionLevel
    if (ADMIN_PAGE_KEYS.has(key) && ['hidden', 'view', 'edit'].includes(level)) permissions[key] = level
  }
  for (const page of ADMIN_PAGE_DEFINITIONS) {
    if (page.maxNonOwnerLevel === 'hidden') permissions[page.key] = 'hidden'
  }
  permissions.permissions = permissions.permissions === 'hidden' ? 'hidden' : 'view'
  return permissions
}

function mapAdminUser(row: Record<string, unknown>): AdminUser {
  const id = Number(row.id)
  const isOwner = Number(row.is_owner ?? 0) === 1
  return {
    id,
    username: String(row.username ?? ''),
    avatar: String(row.avatar ?? ''),
    fullName: String(row.full_name ?? ''),
    isOwner,
    isActive: Number(row.is_active ?? 0) === 1,
    createdAt: Number(row.created_at ?? 0),
    permissions: getAdminPagePermissions(id, isOwner),
  }
}

export function updateAdminPagePermissions(
  userId: number,
  input: Record<string, unknown>,
): AdminUser {
  const current = getAdminUserById(userId)
  if (!current) throw createError({ statusCode: 404, statusMessage: '后台用户不存在' })
  if (current.isOwner) throw createError({ statusCode: 400, statusMessage: '初始所有者始终拥有全部权限' })

  const normalized = defaultAdminPagePermissions()
  for (const page of ADMIN_PAGE_DEFINITIONS) {
    const requested = String(input?.[page.key] ?? normalized[page.key]) as AdminPagePermissionLevel
    if (!['hidden', 'view', 'edit'].includes(requested)) {
      throw createError({ statusCode: 400, statusMessage: `${page.label}的权限值无效` })
    }
    normalized[page.key] = page.maxNonOwnerLevel === 'hidden'
      ? 'hidden'
      : page.maxNonOwnerLevel === 'view' && requested === 'edit'
        ? 'view'
        : requested
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    run('DELETE FROM admin_page_permissions WHERE user_id = ?', userId)
    const now = Date.now()
    for (const page of ADMIN_PAGE_DEFINITIONS) {
      if (normalized[page.key] === page.defaultLevel) continue
      run(
        'INSERT INTO admin_page_permissions (user_id, page_key, level, updated_at) VALUES (?, ?, ?, ?)',
        userId, page.key, normalized[page.key], now,
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return getAdminUserById(userId) as AdminUser
}

function getAdminUserById(id: number): AdminUser | undefined {
  const row = get('SELECT id, username, avatar, full_name, is_owner, is_active, created_at FROM admin_users WHERE id = ?', id)
  return row ? mapAdminUser(row) : undefined
}

export function listAdminUsers(): AdminUser[] {
  return all('SELECT id, username, avatar, full_name, is_owner, is_active, created_at FROM admin_users ORDER BY is_owner DESC, username COLLATE NOCASE')
    .map(mapAdminUser)
}

function requireAdminUsername(value: unknown): string {
  const username = String(value ?? '').trim()
  if (!ADMIN_USER_RE.test(username)) {
    throw createError({ statusCode: 400, statusMessage: '用户名需要为 3 至 32 位字母、数字、下划线或连字符' })
  }
  return username
}

function requireAdminPassword(value: unknown, label = '密码'): string {
  const password = String(value ?? '')
  if (password.length < 12 || password.length > 128) {
    throw createError({ statusCode: 400, statusMessage: `${label}长度需要为 12 至 128 位` })
  }
  return password
}

export function createAdminUser(
  usernameValue: unknown,
  passwordValue: unknown,
  isOwner = false,
  profile: { avatar?: unknown; fullName?: unknown } = {},
): AdminUser {
  const username = requireAdminUsername(usernameValue)
  const password = requireAdminPassword(passwordValue)
  const avatar = requireAdminAvatar(profile.avatar) || (isOwner ? DEFAULT_ADMIN_AVATAR : '')
  const fullName = requireAdminFullName(profile.fullName)
  const now = Date.now()
  try {
    const result = run(
      'INSERT INTO admin_users (username, password_hash, avatar, full_name, is_owner, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
      username, hashAdminPassword(password), avatar, fullName, isOwner ? 1 : 0, now, now,
    )
    const user = getAdminUserById(Number(result.lastInsertRowid))
    if (!user) throw createError({ statusCode: 500, statusMessage: '用户创建失败' })
    return user
  } catch (error: any) {
    if (String(error?.message || '').includes('UNIQUE')) {
      throw createError({ statusCode: 409, statusMessage: '用户名已存在' })
    }
    throw error
  }
}

function requireAdminAvatar(value: unknown): string {
  const avatar = String(value ?? '').trim()
  if (!avatar) return ''
  if (!ADMIN_AVATAR_RE.test(avatar)) {
    throw createError({ statusCode: 400, statusMessage: '头像地址无效' })
  }
  return avatar
}

export function updateAdminAvatar(userId: number, avatarValue: unknown): AdminUser {
  const current = getAdminUserById(userId)
  if (!current) throw createError({ statusCode: 404, statusMessage: '后台用户不存在' })
  run('UPDATE admin_users SET avatar = ?, updated_at = ? WHERE id = ?', requireAdminAvatar(avatarValue), Date.now(), userId)
  return getAdminUserById(userId) as AdminUser
}

function requireAdminFullName(value: unknown): string {
  const fullName = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (fullName.length > 64 || /[\u0000-\u001f\u007f]/.test(fullName)) {
    throw createError({ statusCode: 400, statusMessage: '全名不能超过 64 个字符或包含控制字符' })
  }
  return fullName
}

export function updateAdminFullName(userId: number, fullNameValue: unknown): AdminUser {
  const current = getAdminUserById(userId)
  if (!current) throw createError({ statusCode: 404, statusMessage: '后台用户不存在' })
  run('UPDATE admin_users SET full_name = ?, updated_at = ? WHERE id = ?', requireAdminFullName(fullNameValue), Date.now(), userId)
  return getAdminUserById(userId) as AdminUser
}

export function updateAdminUser(userId: number, changes: { password?: unknown; active?: unknown }): AdminUser {
  const current = getAdminUserById(userId)
  if (!current) throw createError({ statusCode: 404, statusMessage: '后台用户不存在' })
  const password = changes.password === undefined ? undefined : requireAdminPassword(changes.password, '新密码')
  let active: boolean | undefined
  if (changes.active !== undefined) {
    if (typeof changes.active !== 'boolean') throw createError({ statusCode: 400, statusMessage: '用户状态参数无效' })
    active = changes.active
    if (!active && current.isOwner) throw createError({ statusCode: 400, statusMessage: '不能停用所有者账户' })
    if (!active && current.isActive && listAdminUsers().filter((user) => user.isActive).length <= 1) {
      throw createError({ statusCode: 400, statusMessage: '至少需要保留一个启用的后台用户' })
    }
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    if (password !== undefined) {
      run('UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?', hashAdminPassword(password), Date.now(), userId)
      run('DELETE FROM sessions WHERE user_id = ?', userId)
    }
    if (active !== undefined) {
      run('UPDATE admin_users SET is_active = ?, updated_at = ? WHERE id = ?', active ? 1 : 0, Date.now(), userId)
      if (!active) run('DELETE FROM sessions WHERE user_id = ?', userId)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return getAdminUserById(userId) as AdminUser
}

export function deleteAdminUser(userId: number): void {
  const current = getAdminUserById(userId)
  if (!current) throw createError({ statusCode: 404, statusMessage: '后台用户不存在' })
  if (current.isOwner) throw createError({ statusCode: 400, statusMessage: '不能删除所有者账户' })
  if (current.isActive && listAdminUsers().filter((user) => user.isActive).length <= 1) {
    throw createError({ statusCode: 400, statusMessage: '至少需要保留一个启用的后台用户' })
  }
  run('DELETE FROM sessions WHERE user_id = ?', userId)
  run('DELETE FROM admin_page_permissions WHERE user_id = ?', userId)
  run('DELETE FROM admin_users WHERE id = ?', userId)
}

export function requirePagePermission(
  event: H3Event,
  pageKey: string,
  required: 'view' | 'edit',
): AdminUser {
  const user = requireAuth(event)
  if (!permissionAllows(user.permissions[pageKey], required)) {
    throw createError({
      statusCode: 403,
      statusMessage: required === 'edit' ? '当前账户没有此页面的编辑权限' : '当前账户没有此页面的查看权限',
    })
  }
  return user
}

export function requireOwner(event: H3Event): AdminUser {
  const user = requireAuth(event)
  if (!user.isOwner) throw createError({ statusCode: 403, statusMessage: '只有初始所有者可以执行此操作' })
  return user
}

export function getAdminUserForLogin(usernameValue: unknown, password: string): AdminUser | undefined {
  const username = String(usernameValue ?? '').trim()
  const row = get('SELECT id, username, avatar, full_name, password_hash, is_owner, is_active, created_at FROM admin_users WHERE username = ?', username)
  if (!row || Number(row.is_active) !== 1 || !verifyGamePassword(password, String(row.password_hash ?? ''))) return undefined
  return mapAdminUser(row)
}

export function hasSession(token: string): boolean {
  return Boolean(getSessionUser(token))
}

function getSessionUser(token: string): AdminUser | undefined {
  const digest = tokenDigest(token)
  const row = get('SELECT time, user_id FROM sessions WHERE token = ?', digest)
  if (!row) return undefined
  const createdAt = Number(row.time)
  if (!Number.isFinite(createdAt) || createdAt + ADMIN_SESSION_TTL_MS <= Date.now()) {
    deleteSession(token)
    return undefined
  }
  const userId = Number(row.user_id)
  const user = Number.isInteger(userId) ? getAdminUserById(userId) : undefined
  if (!user || !user.isActive) {
    deleteSession(token)
    return undefined
  }
  return user
}

export function createSession(token: string, userId: number) {
  run('INSERT INTO sessions (token, time, user_id) VALUES (?, ?, ?)', tokenDigest(token), Date.now(), userId)
}

export function deleteSession(token: string) {
  run('DELETE FROM sessions WHERE token = ?', tokenDigest(token))
}

export function getAuthenticatedUser(event: H3Event): AdminUser | undefined {
  const cookie = getCookie(event, ADMIN_COOKIE_NAME)
  const header = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  const token = cookie || header
  return token ? getSessionUser(token) : undefined
}

export function requireAuth(event: H3Event): AdminUser {
  const cookie = getCookie(event, ADMIN_COOKIE_NAME)
  const header = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  const token = cookie || header
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: '未登录' })
  }
  const user = getSessionUser(token)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: '会话已失效' })
  }
  event.context.adminUser = user
  return user
}

interface LoginClientInfo {
  browser: string
  os: string
  device: string
}

export function pushLogin(ip: string, time: number, client: LoginClientInfo, username = '') {
  run(
    'INSERT INTO login_history (ip, time, username, browser, os, device) VALUES (?, ?, ?, ?, ?, ?)',
    ip, time, username, client.browser, client.os, client.device,
  )
  run('DELETE FROM login_history WHERE id NOT IN (SELECT id FROM login_history ORDER BY id DESC LIMIT 10)')
}

export function listLogins(): Array<{ ip: string; time: number; username: string; browser: string; os: string; device: string }> {
  return all('SELECT ip, time, username, browser, os, device FROM login_history ORDER BY id DESC') as Array<{
    ip: string
    time: number
    username: string
    browser: string
    os: string
    device: string
  }>
}

export function recordAudit(event: H3Event, user: AdminUser, action = '') {
  const ip = (getHeader(event, 'cf-connecting-ip') || getRequestIP(event) || 'unknown').slice(0, 64)
  const url = getRequestURL(event)
  run(
    'INSERT INTO audit_logs (user_id, username, action, method, path, ip, time) VALUES (?, ?, ?, ?, ?, ?, ?)',
    user.id, user.username, action || `${event.method || 'UNKNOWN'} ${url.pathname}`, event.method || 'UNKNOWN', url.pathname, ip, Date.now(),
  )
  run('DELETE FROM audit_logs WHERE id NOT IN (SELECT id FROM audit_logs ORDER BY id DESC LIMIT 5000)')
}

export function listAuditLogs(limit = 300) {
  const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 300
  const safeLimit = Math.min(1000, Math.max(1, normalizedLimit))
  return all(`SELECT id, username, action, method, path, ip, time FROM audit_logs ORDER BY id DESC LIMIT ${safeLimit}`)
}

interface Activity {
  id: string
  type: string
  date: string
  content: string
}

export function listActivities(): Activity[] {
  return all('SELECT id, type, date, content FROM activities ORDER BY rowid DESC') as Activity[]
}

export function insertActivity(item: Activity) {
  run('INSERT INTO activities (id, type, date, content) VALUES (?, ?, ?, ?)', item.id, item.type, item.date, item.content)
}

export function updateActivity(item: Activity) {
  run('UPDATE activities SET type = ?, date = ?, content = ? WHERE id = ?', item.type, item.date, item.content, item.id)
}

export function deleteActivity(id: string) {
  run('DELETE FROM activities WHERE id = ?', id)
}

interface Donor {
  id: string
  avatar: string
  name: string
  intro: string
  amount: number
}

export function listDonors(): Donor[] {
  return all('SELECT id, avatar, name, intro, amount FROM donors ORDER BY rowid DESC') as Donor[]
}

export function insertDonor(item: Donor) {
  run('INSERT INTO donors (id, avatar, name, intro, amount) VALUES (?, ?, ?, ?, ?)', item.id, item.avatar, item.name, item.intro, item.amount)
}

export function updateDonor(item: Donor) {
  run('UPDATE donors SET avatar = ?, name = ?, intro = ?, amount = ? WHERE id = ?', item.avatar, item.name, item.intro, item.amount, item.id)
}

export function deleteDonor(id: string) {
  run('DELETE FROM donors WHERE id = ?', id)
}

interface Ban {
  id: string
  player: string
  banTime: string
  unbanTime: string
  reason: string
}

export function listBans(): Ban[] {
  return all('SELECT id, player, ban_time, unban_time, reason FROM bans ORDER BY rowid DESC').map((r) => ({
    id: r.id as string,
    player: r.player as string,
    banTime: r.ban_time as string,
    unbanTime: r.unban_time as string,
    reason: r.reason as string,
  }))
}

export function insertBan(item: Ban) {
  run('INSERT INTO bans (id, player, ban_time, unban_time, reason) VALUES (?, ?, ?, ?, ?)', item.id, item.player, item.banTime, item.unbanTime, item.reason)
}

export function updateBan(item: Ban) {
  run('UPDATE bans SET player = ?, ban_time = ?, unban_time = ?, reason = ? WHERE id = ?', item.player, item.banTime, item.unbanTime, item.reason, item.id)
}

export function deleteBan(id: string) {
  run('DELETE FROM bans WHERE id = ?', id)
}

interface UpdateEntry {
  id: string
  key: string
  name: string
  latestVersion: string
  type: string
  forcedUpdate: boolean
  release_date: string
  release_time: string
  changelog: string[]
}

export function listUpdates(): UpdateEntry[] {
  return all('SELECT id, key, name, latest_version, type, forced_update, release_date, release_time, changelog FROM updates ORDER BY rowid DESC').map((r) => ({
    id: r.id as string,
    key: r.key as string,
    name: r.name as string,
    latestVersion: r.latest_version as string,
    type: r.type as string,
    forcedUpdate: !!r.forced_update,
    release_date: r.release_date as string,
    release_time: r.release_time as string,
    changelog: r.changelog ? (JSON.parse(r.changelog as string) as string[]) : [],
  }))
}

export function insertUpdate(item: UpdateEntry) {
  run(
    'INSERT INTO updates (id, key, name, latest_version, type, forced_update, release_date, release_time, changelog) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    item.id,
    item.key,
    item.name,
    item.latestVersion,
    item.type,
    item.forcedUpdate ? 1 : 0,
    item.release_date,
    item.release_time,
    JSON.stringify(item.changelog ?? [])
  )
}

export function updateUpdate(item: UpdateEntry) {
  run(
    'UPDATE updates SET key = ?, name = ?, latest_version = ?, type = ?, forced_update = ?, release_date = ?, release_time = ?, changelog = ? WHERE id = ?',
    item.key,
    item.name,
    item.latestVersion,
    item.type,
    item.forcedUpdate ? 1 : 0,
    item.release_date,
    item.release_time,
    JSON.stringify(item.changelog ?? []),
    item.id
  )
}

export function deleteUpdate(id: string) {
  run('DELETE FROM updates WHERE id = ?', id)
}

/** 访客只填昵称；玩家用游戏账户登录；管理员由后台代发。 */
export type ChatRole = 'guest' | 'player' | 'admin'

export interface ChatMessage {
  id: string
  name: string
  content: string
  /** 后台代发时为管理员头像路径；其余为空串，由官网按昵称生成像素头像。 */
  avatar: string
  /** 由服务端按凭据判定，公开接口无法自行指定，因此可作为可信标记。 */
  role: ChatRole
  location: string
  time: number
}

export interface AdminChatMessage extends ChatMessage {
  // 只暴露 IP 哈希前缀，便于后台辨认惯犯，同时不还原真实 IP。
  ipTag: string
}

export function chatIpHash(ip: string): string {
  return tokenDigest(ip || 'unknown')
}

export function requireChatName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!CHAT_NAME_RE.test(name)) {
    throw createError({
      statusCode: 400,
      statusMessage: `昵称需为 2-${CHAT_NAME_MAX} 位中英文、数字、下划线或连字符`,
    })
  }
  return name
}

export function requireChatContent(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  // 只保留换行和可打印字符，滤掉终端转义、NUL 等不可见控制字符。
  const printable = Array.from(raw)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      return char === '\n' || char === '\r' || (code >= 32 && code !== 127)
    })
    .join('')
  const content = printable
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!content) {
    throw createError({ statusCode: 400, statusMessage: '消息内容不能为空' })
  }
  if (content.length > CHAT_CONTENT_MAX) {
    throw createError({ statusCode: 400, statusMessage: `消息内容不能超过 ${CHAT_CONTENT_MAX} 个字符` })
  }
  return content
}

function normalizeChatRole(value: unknown): ChatRole {
  return value === 'admin' || value === 'player' ? value : 'guest'
}

function mapChatMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: String(row.id),
    name: String(row.name),
    content: String(row.content),
    avatar: String(row.avatar || ''),
    role: normalizeChatRole(row.role),
    location: String(row.ip_location || '未知'),
    time: Number(row.created_at) || 0,
  }
}

function normalizeChatLimit(limit: number): number {
  const normalized = Number.isFinite(limit) ? Math.trunc(limit) : CHAT_HISTORY_LIMIT
  return Math.min(CHAT_RETAINED_ROWS, Math.max(1, normalized))
}

// 返回最旧在前，前端可直接顺序渲染成聊天流。
export function listChatMessages(limit = CHAT_HISTORY_LIMIT): ChatMessage[] {
  const rows = all(
    'SELECT id, name, content, avatar, role, ip_location, created_at FROM chat_messages ORDER BY created_at DESC, rowid DESC LIMIT ?',
    normalizeChatLimit(limit),
  )
  return rows.map(mapChatMessage).reverse()
}

export function listAdminChatMessages(limit = CHAT_RETAINED_ROWS): AdminChatMessage[] {
  const rows = all(
    'SELECT id, name, content, avatar, role, ip_location, ip_hash, created_at FROM chat_messages ORDER BY created_at DESC, rowid DESC LIMIT ?',
    normalizeChatLimit(limit),
  )
  return rows.map((row) => ({ ...mapChatMessage(row), ipTag: String(row.ip_hash).slice(0, 12) }))
}

export function assertChatSendAllowed(ipHash: string, content: string): void {
  const now = Date.now()

  const recent = get(
    'SELECT COUNT(*) AS total FROM chat_messages WHERE ip_hash = ? AND created_at > ?',
    ipHash, now - CHAT_RATE_WINDOW_MS,
  )
  if (Number(recent?.total ?? 0) >= CHAT_RATE_MAX_MESSAGES) {
    const oldest = get(
      'SELECT MIN(created_at) AS earliest FROM chat_messages WHERE ip_hash = ? AND created_at > ?',
      ipHash, now - CHAT_RATE_WINDOW_MS,
    )
    const earliest = Number(oldest?.earliest ?? now)
    const retryAfterSeconds = Math.max(1, Math.ceil((earliest + CHAT_RATE_WINDOW_MS - now) / 1000))
    throw createError({
      statusCode: 429,
      statusMessage: `发言过于频繁，每分钟最多 ${CHAT_RATE_MAX_MESSAGES} 条，请 ${retryAfterSeconds} 秒后再试`,
      data: { retryAfterSeconds },
    })
  }

  const last = get(
    'SELECT content FROM chat_messages WHERE ip_hash = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    ipHash,
  )
  if (last && String(last.content) === content) {
    throw createError({ statusCode: 400, statusMessage: '不能连续发送相同的消息' })
  }
}

export function insertChatMessage(input: {
  name: string
  content: string
  ipHash: string
  location: string
  avatar?: string
  role?: ChatRole
}): ChatMessage {
  const now = Date.now()
  const message: ChatMessage = {
    id: `chat_${now.toString(36)}${randomBytes(6).toString('hex')}`,
    // 后台代发时昵称来自管理员全名（上限 64），这里统一做一次防御性截断。
    name: input.name.slice(0, 64),
    content: input.content,
    avatar: (input.avatar || '').slice(0, 256),
    role: normalizeChatRole(input.role),
    location: input.location || '未知',
    time: now,
  }
  run(
    `INSERT INTO chat_messages (id, name, content, avatar, role, ip_hash, ip_location, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    message.id, message.name, message.content, message.avatar, message.role,
    input.ipHash, message.location, now,
  )
  // 只回收超出保留条数且已经离开限流窗口的记录，避免高峰期把限流依据删掉。
  run(
    `DELETE FROM chat_messages
     WHERE created_at < ?
       AND id NOT IN (SELECT id FROM chat_messages ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
    now - CHAT_RATE_WINDOW_MS, CHAT_RETAINED_ROWS,
  )
  return message
}

export function deleteChatMessage(id: string): boolean {
  const result = run('DELETE FROM chat_messages WHERE id = ?', id)
  return Number(result.changes ?? 0) > 0
}

export function clearChatMessages(): number {
  const result = run('DELETE FROM chat_messages')
  return Number(result.changes ?? 0)
}

/*
 * 聊天区玩家登录：独立于 game_sessions。
 * 刻意不复用 createGameSession —— 后者会删掉该玩家已有的游戏会话，
 * 网页登录一次就会把人踢下线。这里也不读写 game_accounts.loginTries，
 * 避免有人拿别人的玩家代号在网页上乱试密码、把对方锁在游戏外。
 */

export function assertChatLoginAllowed(ip: string): void {
  const now = Date.now()
  const key = tokenDigest(ip || 'unknown')
  const row = get('SELECT window_started, attempts FROM chat_login_rate_limits WHERE rate_key = ?', key)
  if (!row) return
  const started = Number(row.window_started)
  if (!Number.isFinite(started) || started + CHAT_LOGIN_RATE_WINDOW_MS <= now) {
    run('DELETE FROM chat_login_rate_limits WHERE rate_key = ?', key)
    return
  }
  if (Number(row.attempts) >= CHAT_LOGIN_RATE_MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((started + CHAT_LOGIN_RATE_WINDOW_MS - now) / 1000))
    throw createError({
      statusCode: 429,
      statusMessage: '登录尝试过多，请稍后重试',
      data: { retryAfterSeconds },
    })
  }
}

export function recordChatLoginFailure(ip: string): void {
  const now = Date.now()
  const key = tokenDigest(ip || 'unknown')
  const row = get('SELECT window_started FROM chat_login_rate_limits WHERE rate_key = ?', key)
  const started = Number(row?.window_started)
  if (!row || !Number.isFinite(started) || started + CHAT_LOGIN_RATE_WINDOW_MS <= now) {
    run(`INSERT INTO chat_login_rate_limits (rate_key, window_started, attempts) VALUES (?, ?, 1)
         ON CONFLICT(rate_key) DO UPDATE SET window_started = excluded.window_started, attempts = 1`, key, now)
    return
  }
  run('UPDATE chat_login_rate_limits SET attempts = attempts + 1 WHERE rate_key = ?', key)
}

export function clearChatLoginFailures(ip: string): void {
  run('DELETE FROM chat_login_rate_limits WHERE rate_key = ?', tokenDigest(ip || 'unknown'))
}

/** 校验游戏账户凭据，成功返回账户内记录的规范大小写玩家代号。 */
export function verifyChatPlayerLogin(usernameValue: unknown, passwordValue: unknown): string {
  const username = requireGameUsername(usernameValue)
  const account = getGameAccount(username)
  const password = typeof passwordValue === 'string' ? passwordValue : ''

  // 账户不存在与密码错误返回同一条文案，避免暴露哪些玩家代号已注册。
  if (!account?.password || !verifyGamePassword(password, account.password)) {
    throw createError({ statusCode: 401, statusMessage: '玩家代号或密码错误' })
  }
  return account.username
}

export function createChatPlayerSession(username: string): { token: string; expiresAt: number } {
  cleanupChatPlayerSessions()
  const token = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + CHAT_PLAYER_SESSION_TTL_MS
  run(
    'INSERT INTO chat_player_sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)',
    tokenDigest(token), username, Date.now(), expiresAt,
  )
  return { token, expiresAt }
}

/** 校验聊天会话令牌，返回玩家代号；失效时抛 401。 */
export function requireChatPlayerSession(tokenValue: unknown): string {
  const token = typeof tokenValue === 'string' ? tokenValue.trim() : ''
  if (!token || token.length > 128) {
    throw createError({ statusCode: 401, statusMessage: '登录状态已失效，请重新登录' })
  }
  const digest = tokenDigest(token)
  const row = get('SELECT username, expires_at FROM chat_player_sessions WHERE token = ?', digest)
  if (!row) {
    throw createError({ statusCode: 401, statusMessage: '登录状态已失效，请重新登录' })
  }
  if (Number(row.expires_at) <= Date.now()) {
    run('DELETE FROM chat_player_sessions WHERE token = ?', digest)
    throw createError({ statusCode: 401, statusMessage: '登录状态已过期，请重新登录' })
  }
  return String(row.username)
}

export function deleteChatPlayerSession(tokenValue: unknown): void {
  const token = typeof tokenValue === 'string' ? tokenValue.trim() : ''
  if (!token) return
  run('DELETE FROM chat_player_sessions WHERE token = ?', tokenDigest(token))
}

function cleanupChatPlayerSessions(now = Date.now()): void {
  run('DELETE FROM chat_player_sessions WHERE expires_at <= ?', now)
}

export function getCachedIpLocation(ipHash: string): string | undefined {
  const row = get('SELECT location, updated_at FROM ip_locations WHERE ip_hash = ?', ipHash)
  if (!row) return undefined
  const updatedAt = Number(row.updated_at)
  if (!Number.isFinite(updatedAt) || updatedAt + IP_LOCATION_TTL_MS <= Date.now()) {
    run('DELETE FROM ip_locations WHERE ip_hash = ?', ipHash)
    return undefined
  }
  const location = String(row.location || '').trim()
  return location || undefined
}

export function setCachedIpLocation(ipHash: string, location: string): void {
  const value = location.trim().slice(0, 64)
  if (!value) return
  run(
    `INSERT INTO ip_locations (ip_hash, location, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(ip_hash) DO UPDATE SET location = excluded.location, updated_at = excluded.updated_at`,
    ipHash, value, Date.now(),
  )
}

export function assertAdminLoginAllowed(ip: string): void {
  const now = Date.now()
  const key = tokenDigest(ip || 'unknown')
  const row = get('SELECT window_started, attempts FROM admin_login_rate_limits WHERE rate_key = ?', key)
  if (!row) return
  const started = Number(row.window_started)
  const attempts = Number(row.attempts)
  if (!Number.isFinite(started) || started + LOGIN_RATE_WINDOW_MS <= now) {
    run('DELETE FROM admin_login_rate_limits WHERE rate_key = ?', key)
    return
  }
  if (attempts >= LOGIN_RATE_MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((started + LOGIN_RATE_WINDOW_MS - now) / 1000))
    throw createError({ statusCode: 429, statusMessage: '登录尝试过多，请稍后重试', data: { retryAfterSeconds } })
  }
}

export function recordAdminLoginFailure(ip: string): void {
  const now = Date.now()
  const key = tokenDigest(ip || 'unknown')
  const row = get('SELECT window_started, attempts FROM admin_login_rate_limits WHERE rate_key = ?', key)
  const started = Number(row?.window_started)
  if (!row || !Number.isFinite(started) || started + LOGIN_RATE_WINDOW_MS <= now) {
    run(`INSERT INTO admin_login_rate_limits (rate_key, window_started, attempts) VALUES (?, ?, 1)
         ON CONFLICT(rate_key) DO UPDATE SET window_started = excluded.window_started, attempts = 1`, key, now)
    return
  }
  run('UPDATE admin_login_rate_limits SET attempts = attempts + 1 WHERE rate_key = ?', key)
}

export function clearAdminLoginFailures(ip: string): void {
  run('DELETE FROM admin_login_rate_limits WHERE rate_key = ?', tokenDigest(ip || 'unknown'))
}

export function requireGameApiKey(event: H3Event): void {
  if (event.context.yzwcGameRequestAuthenticated === true) return
  throw createError({ statusCode: 401, statusMessage: '服务器 Api 请求签名无效' })
}

export function authenticateGameApiRequest(event: H3Event, body: Buffer): void {
  const expected = requireConfiguredGameApiKey()
  const timestamp = getHeader(event, 'x-yzwc-timestamp') || ''
  const nonce = getHeader(event, 'x-yzwc-nonce') || ''
  const provided = getHeader(event, 'x-yzwc-signature') || ''
  const timestampSeconds = Number(timestamp)
  if (!/^\d{10,}$/.test(timestamp) || !Number.isSafeInteger(timestampSeconds)
      || Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > GAME_REQUEST_MAX_SKEW_SECONDS
      || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)
      || !/^[a-f0-9]{64}$/i.test(provided)) {
    throw createError({ statusCode: 401, statusMessage: '服务器 Api 请求签名无效' })
  }
  const method = event.method.toUpperCase()
  const bodyHash = createHash('sha256').update(body).digest('hex')
  const canonical = `${timestamp}.${nonce}.${method}.${event.path}.${bodyHash}`
  const expectedSignature = createHmac('sha256', expected).update(canonical).digest('hex')
  if (!safeEqualHex(provided, expectedSignature)) {
    throw createError({ statusCode: 401, statusMessage: '服务器 Api 请求签名无效' })
  }
  const now = Date.now()
  run('DELETE FROM api_request_nonces WHERE expires_at <= ?', now)
  try {
    run('INSERT INTO api_request_nonces (nonce, expires_at) VALUES (?, ?)', nonce, now + GAME_REQUEST_NONCE_TTL_MS)
  } catch {
    throw createError({ statusCode: 409, statusMessage: '服务器 Api 请求重复提交' })
  }
  event.context.yzwcGameRequestAuthenticated = true
}

function requireConfiguredGameApiKey(): string {
  const key = getGameApiKey()
  if (key.length < 32 || key.length > 512 || /\s/.test(key)) {
    throw createError({ statusCode: 503, statusMessage: `${GAME_API_KEY_ENV} 未配置或长度无效` })
  }
  return key
}

function safeEqualHex(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

function requireSecret(name: string, minLength: number): string {
  const value = process.env[name]?.trim() || ''
  if (value.length < minLength) {
    throw createError({ statusCode: 503, message: `${name} 未配置或长度不足` })
  }
  return value
}

export function validateRuntimeSecurityConfig(): void {
  if (isAdminInitialized()) {
    requireConfiguredGameApiKey()
    getAdminEntry()
  }
}

export interface GameAccount {
  username: string
  usernameLower: string
  uuid: string | null
  email: string | null
  password: string
  lastIp: string
  lastLoginIp: string
  lastAuthenticatedDate: string
  registrationDate: string
  loginTries: number
  lastKickedDate: string
  lastPosition: string | null
  inPlaceRespawnCount: number
}

export function gameAccountWire(account: GameAccount) {
  const result: Record<string, unknown> = {
    username: account.username,
    username_lower: account.usernameLower,
    uuid: account.uuid,
    email: account.email,
    last_ip: account.lastIp,
    last_authenticated_date: account.lastAuthenticatedDate,
    registration_date: account.registrationDate,
    login_tries: account.loginTries,
    last_kicked_date: account.lastKickedDate,
    last_position: account.lastPosition,
    in_place_respawn_count: account.inPlaceRespawnCount,
    registered: Boolean(account.password),
    last_login_ip: account.lastLoginIp,
  }
  return result
}

function mapGameAccount(row: Record<string, unknown>): GameAccount {
  return {
    username: String(row.username ?? ''),
    usernameLower: String(row.username_lower ?? ''),
    uuid: row.uuid == null || String(row.uuid).trim() === ''
      ? offlinePlayerUuid(String(row.username ?? ''))
      : String(row.uuid),
    email: row.email == null || String(row.email).trim() === '' ? null : String(row.email),
    password: String(row.password ?? ''),
    lastIp: String(row.last_ip ?? ''),
    lastLoginIp: String(row.last_login_ip ?? row.last_ip ?? ''),
    lastAuthenticatedDate: String(row.last_authenticated_date ?? '1970-01-01T00:00:00Z'),
    registrationDate: String(row.registration_date ?? '1970-01-01T00:00:00Z'),
    loginTries: Number(row.login_tries ?? 0),
    lastKickedDate: String(row.last_kicked_date ?? '1970-01-01T00:00:00Z'),
    lastPosition: row.last_position == null ? null : String(row.last_position),
    inPlaceRespawnCount: Number(row.in_place_respawn_count ?? 0),
  }
}

export function listGameAccounts(): GameAccount[] {
  return all('SELECT * FROM game_accounts ORDER BY username_lower').map(mapGameAccount)
}

export function getGameAccount(username: string): GameAccount | undefined {
  const key = username.trim().toLocaleLowerCase('en-US')
  const row = get('SELECT * FROM game_accounts WHERE username_lower = ?', key)
  return row ? mapGameAccount(row) : undefined
}

export function upsertGameAccount(account: GameAccount) {
  run(`INSERT INTO game_accounts
    (username_lower, username, uuid, email, password, last_ip, last_login_ip, last_authenticated_date, registration_date,
     login_tries, last_kicked_date, last_position, in_place_respawn_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(username_lower) DO UPDATE SET
      username = excluded.username, uuid = COALESCE(excluded.uuid, game_accounts.uuid),
      email = COALESCE(excluded.email, game_accounts.email),
      password = CASE WHEN excluded.password = '' THEN game_accounts.password ELSE excluded.password END,
      last_ip = excluded.last_ip,
      last_login_ip = excluded.last_login_ip,
      last_authenticated_date = excluded.last_authenticated_date,
      registration_date = excluded.registration_date, login_tries = excluded.login_tries,
      last_kicked_date = excluded.last_kicked_date, last_position = excluded.last_position,
      in_place_respawn_count = excluded.in_place_respawn_count, updated_at = excluded.updated_at`,
    account.usernameLower, account.username, account.uuid, account.email, account.password, account.lastIp,
    account.lastLoginIp, account.lastAuthenticatedDate, account.registrationDate, account.loginTries, account.lastKickedDate,
    account.lastPosition, account.inPlaceRespawnCount, Date.now())
  if (account.password) {
    run('DELETE FROM game_registration_sessions WHERE username_lower = ?', account.usernameLower)
  }
}

export function deleteGameAccount(username: string): boolean {
  const key = username.trim().toLocaleLowerCase('en-US')
  const result = run('DELETE FROM game_accounts WHERE username_lower = ?', key)
  run('DELETE FROM game_sessions WHERE username_lower = ?', key)
  run('DELETE FROM game_registration_sessions WHERE username_lower = ?', key)
  run('DELETE FROM game_password_reset_sessions WHERE username_lower = ?', key)
  run('DELETE FROM game_email_change_sessions WHERE username_lower = ?', key)
  return Number(result.changes ?? 0) > 0
}

export function createGameSession(username: string, expiresAt: number | null = null): string {
  deleteGameSessionsForUser(username)
  const token = randomBytes(32).toString('hex')
  const effectiveExpiresAt = expiresAt ?? Date.now() + gameSessionTtlMs()
  run('INSERT INTO game_sessions (token, username_lower, created_at, expires_at) VALUES (?, ?, ?, ?)',
    tokenDigest(token), username.trim().toLocaleLowerCase('en-US'), Date.now(), effectiveExpiresAt)
  return token
}

export function requireGameSession(token: string): GameAccount {
  const digest = tokenDigest(token)
  const row = get('SELECT username_lower, expires_at FROM game_sessions WHERE token = ?', digest)
  if (!row) {
    throw createError({ statusCode: 401, message: '游戏会话已失效' })
  }
  const expiresAt = row.expires_at == null ? null : Number(row.expires_at)
  if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    run('DELETE FROM game_sessions WHERE token = ?', digest)
    throw createError({ statusCode: 401, message: '游戏会话已过期' })
  }
  const account = getGameAccount(String(row.username_lower))
  if (!account) throw createError({ statusCode: 401, message: '账户不存在' })
  return account
}

export function deleteGameSession(token: string) {
  run('DELETE FROM game_sessions WHERE token = ?', tokenDigest(token))
}

export function deleteGameSessionsForUser(username: string) {
  const key = username.trim().toLocaleLowerCase('en-US')
  run('DELETE FROM game_sessions WHERE username_lower = ?', key)
  // 登录、改密或管理员重置后，旧的找回密码验证码不应继续有效。
  run('DELETE FROM game_password_reset_sessions WHERE username_lower = ?', key)
  // 登录态变化后，旧会话发起的换绑邮箱验证码也不应继续有效。
  run('DELETE FROM game_email_change_sessions WHERE username_lower = ?', key)
}

function gameSessionTtlMs(): number {
  const raw = Number(process.env.YZWC_GAME_SESSION_TTL_SECONDS ?? 43_200)
  const seconds = Number.isFinite(raw) ? Math.trunc(raw) : 43_200
  return Math.min(86_400, Math.max(300, seconds)) * 1000
}

export type SmtpSecurity = 'none' | 'starttls' | 'tls'

export interface SmtpTransportSettings {
  host: string
  port: number
  security: SmtpSecurity
  username: string
  password: string
  fromAddress: string
  fromName: string
}

export interface GameAccountSettings {
  loginCooldown: number
  emailVerificationRequired: boolean
  smtpConfigured: boolean
}

export interface AdminGameAccountSettings extends GameAccountSettings {
  smtp: Omit<SmtpTransportSettings, 'password'> & { passwordConfigured: boolean }
  emailTemplates: VerificationEmailTemplates
}

interface StoredSmtpSettings extends Omit<SmtpTransportSettings, 'password'> {
  encryptedPassword: string
}

function readStoredSmtpSettings(): StoredSmtpSettings {
  const rawPort = Number(getSetting(SMTP_PORT_SETTING) ?? 587)
  const rawSecurity = getSetting(SMTP_SECURITY_SETTING)
  return {
    host: getSetting(SMTP_HOST_SETTING)?.trim() || '',
    port: Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65_535 ? rawPort : 587,
    security: rawSecurity === 'none' || rawSecurity === 'tls' ? rawSecurity : 'starttls',
    username: getSetting(SMTP_USERNAME_SETTING)?.trim() || '',
    encryptedPassword: getSetting(SMTP_PASSWORD_SETTING) || '',
    fromAddress: getSetting(SMTP_FROM_ADDRESS_SETTING)?.trim() || '',
    fromName: getSetting(SMTP_FROM_NAME_SETTING)?.trim() || '悠哉世界',
  }
}

function smtpSettingsAreComplete(settings: StoredSmtpSettings): boolean {
  if (!settings.host || !settings.fromAddress || !Number.isInteger(settings.port)
      || settings.port < 1 || settings.port > 65_535
      || (settings.username && !settings.encryptedPassword)) return false
  try {
    requireEmailAddress(settings.fromAddress)
    return true
  } catch {
    return false
  }
}

function smtpEncryptionKey(): Buffer {
  return createHash('sha256').update(`yzwc-smtp:${requireSecret(GAME_API_KEY_ENV, 32)}`).digest()
}

function encryptSmtpPassword(password: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', smtpEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`
}

function decryptSmtpPassword(payload: string): string {
  try {
    const [version, ivText, tagText, encryptedText] = payload.split('.')
    if (version !== 'v1' || !ivText || !tagText || !encryptedText) throw new Error('invalid payload')
    const decipher = createDecipheriv('aes-256-gcm', smtpEncryptionKey(), Buffer.from(ivText, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw createError({ statusCode: 503, message: 'SMTP 密码无法解密，请重新保存 SMTP 配置' })
  }
}

function smtpSettingsAreUsable(settings: StoredSmtpSettings): boolean {
  if (!smtpSettingsAreComplete(settings)) return false
  if (!settings.username) return true
  try {
    decryptSmtpPassword(settings.encryptedPassword)
    return true
  } catch {
    return false
  }
}

function requireSmtpText(value: unknown, label: string, maxLength: number, required = false): string {
  const text = String(value ?? '').trim()
  if ((required && !text) || text.length > maxLength || /[\r\n]/.test(text)) {
    throw createError({ statusCode: 400, message: `${label}格式不正确` })
  }
  return text
}

export function getGameAccountSettings(): GameAccountSettings {
  const loginCooldown = Number(getSetting('game_account.login_cooldown') ?? 300)
  const smtp = readStoredSmtpSettings()
  return {
    loginCooldown: Number.isFinite(loginCooldown)
      ? Math.min(86_400, Math.max(-1, Math.trunc(loginCooldown)))
      : 300,
    emailVerificationRequired: getSetting(GAME_EMAIL_VERIFICATION_SETTING) === 'true',
    smtpConfigured: smtpSettingsAreUsable(smtp),
  }
}

export function getAdminGameAccountSettings(): AdminGameAccountSettings {
  const settings = getGameAccountSettings()
  const smtp = readStoredSmtpSettings()
  return {
    ...settings,
    smtp: {
      host: smtp.host,
      port: smtp.port,
      security: smtp.security,
      username: smtp.username,
      fromAddress: smtp.fromAddress,
      fromName: smtp.fromName,
      passwordConfigured: Boolean(smtp.encryptedPassword),
    },
    emailTemplates: getVerificationEmailTemplates(),
  }
}

export function getVerificationEmailTemplates(): VerificationEmailTemplates {
  const templates = cloneVerificationEmailTemplates()
  const raw = getSetting(EMAIL_TEMPLATES_SETTING)
  if (!raw) {
    for (const kind of VERIFICATION_EMAIL_TEMPLATE_KINDS) {
      templates[kind].html = buildVerificationEmailTemplateSource(templates[kind])
    }
    return templates
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const kind of VERIFICATION_EMAIL_TEMPLATE_KINDS) {
      templates[kind] = resolveVerificationEmailTemplate(parsed?.[kind], DEFAULT_VERIFICATION_EMAIL_TEMPLATES[kind])
      if (!templates[kind].html.trim()) templates[kind].html = buildVerificationEmailTemplateSource(templates[kind])
      templates[kind].html = templates[kind].html
        .replaceAll(VERIFICATION_EMAIL_LOGO_URL, '{{logoUrl}}')
        .replaceAll('/images/uzw-tm.png', '{{logoUrl}}')
    }
  } catch {
    for (const kind of VERIFICATION_EMAIL_TEMPLATE_KINDS) {
      templates[kind].html = buildVerificationEmailTemplateSource(templates[kind])
    }
    return templates
  }
  return templates
}

export function getSmtpTransportSettings(): SmtpTransportSettings {
  const smtp = readStoredSmtpSettings()
  if (!smtpSettingsAreComplete(smtp)) {
    throw createError({ statusCode: 503, message: 'SMTP 服务器尚未配置' })
  }
  return {
    host: smtp.host,
    port: smtp.port,
    security: smtp.security,
    username: smtp.username,
    password: smtp.username ? decryptSmtpPassword(smtp.encryptedPassword) : '',
    fromAddress: requireEmailAddress(smtp.fromAddress),
    fromName: smtp.fromName,
  }
}

export function setGameAccountSettings(
  settings: Partial<Pick<GameAccountSettings, 'loginCooldown'>>,
): GameAccountSettings {
  const current = getGameAccountSettings()
  const loginCooldown = settings.loginCooldown === undefined
    ? current.loginCooldown
    : Math.min(86_400, Math.max(-1, Math.trunc(Number(settings.loginCooldown) || 0)))
  setSetting('game_account.login_cooldown', String(loginCooldown))
  return getGameAccountSettings()
}

export function setAdminGameAccountSettings(input: Record<string, any>): AdminGameAccountSettings {
  const current = getAdminGameAccountSettings()
  const currentStoredSmtp = readStoredSmtpSettings()
  const smtpInput = input?.smtp
  const hasSmtpInput = smtpInput !== undefined
  if (hasSmtpInput && (!smtpInput || typeof smtpInput !== 'object' || Array.isArray(smtpInput))) {
    throw createError({ statusCode: 400, message: 'SMTP 配置格式不正确' })
  }

  const emailTemplatesInput = input?.emailTemplates
  const hasEmailTemplatesInput = emailTemplatesInput !== undefined
  if (hasEmailTemplatesInput && (!emailTemplatesInput || typeof emailTemplatesInput !== 'object' || Array.isArray(emailTemplatesInput))) {
    throw createError({ statusCode: 400, message: '邮件模板格式不正确' })
  }
  const nextEmailTemplates = getVerificationEmailTemplates()
  if (hasEmailTemplatesInput) {
    try {
      for (const kind of VERIFICATION_EMAIL_TEMPLATE_KINDS) {
        if (emailTemplatesInput[kind] !== undefined) {
          nextEmailTemplates[kind] = resolveVerificationEmailTemplate(
            emailTemplatesInput[kind],
            nextEmailTemplates[kind],
          )
        }
      }
    } catch (error) {
      throw createError({ statusCode: 400, message: error instanceof Error ? error.message : '邮件模板格式不正确' })
    }
  }

  const nextSmtp: StoredSmtpSettings = { ...currentStoredSmtp }
  let smtpPasswordReplaced = false
  if (hasSmtpInput) {
    if (smtpInput.host !== undefined) {
      nextSmtp.host = requireSmtpText(smtpInput.host, 'SMTP 服务器地址', 255, true)
      if (!/^[A-Za-z0-9.:[\]-]+$/.test(nextSmtp.host)) {
        throw createError({ statusCode: 400, message: 'SMTP 服务器地址格式不正确' })
      }
    }
    if (smtpInput.port !== undefined) {
      const port = Number(smtpInput.port)
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw createError({ statusCode: 400, message: 'SMTP 端口格式不正确' })
      }
      nextSmtp.port = port
    }
    if (smtpInput.security !== undefined) {
      const security = String(smtpInput.security)
      if (security !== 'none' && security !== 'starttls' && security !== 'tls') {
        throw createError({ statusCode: 400, message: 'SMTP 连接安全类型不正确' })
      }
      nextSmtp.security = security
    }
    if (smtpInput.username !== undefined) {
      nextSmtp.username = requireSmtpText(smtpInput.username, 'SMTP 用户名', 320)
    }
    if (smtpInput.fromAddress !== undefined) {
      nextSmtp.fromAddress = requireEmailAddress(smtpInput.fromAddress)
    }
    if (smtpInput.fromName !== undefined) {
      nextSmtp.fromName = requireSmtpText(smtpInput.fromName, '发件人名称', 128) || '悠哉世界'
    }
    if (smtpInput.password !== undefined && String(smtpInput.password) !== '') {
      const password = String(smtpInput.password)
      if (password.length > 1024 || /[\r\n]/.test(password)) {
        throw createError({ statusCode: 400, message: 'SMTP 密码格式不正确' })
      }
      nextSmtp.encryptedPassword = encryptSmtpPassword(password)
      smtpPasswordReplaced = true
    }
    if (!nextSmtp.username) {
      if (smtpInput.password !== undefined && String(smtpInput.password) !== '') {
        throw createError({ statusCode: 400, message: '填写 SMTP 密码时必须同时填写用户名' })
      }
      nextSmtp.encryptedPassword = ''
    }
    if (nextSmtp.username && nextSmtp.username !== currentStoredSmtp.username && !smtpPasswordReplaced) {
      throw createError({ statusCode: 400, message: '更换 SMTP 用户名时必须重新填写密码' })
    }
    if (nextSmtp.security === 'none' && nextSmtp.username) {
      throw createError({ statusCode: 400, message: '使用 SMTP 认证时必须启用 STARTTLS 或 TLS' })
    }
    if (!smtpSettingsAreComplete(nextSmtp)) {
      throw createError({ statusCode: 400, message: '请完整填写 SMTP 服务器配置' })
    }
    if (nextSmtp.username && !smtpPasswordReplaced) decryptSmtpPassword(nextSmtp.encryptedPassword)
  }

  let emailVerificationRequired = current.emailVerificationRequired
  if (input?.emailVerificationRequired !== undefined) {
    if (typeof input.emailVerificationRequired !== 'boolean') {
      throw createError({ statusCode: 400, message: '邮箱验证开关参数不正确' })
    }
    emailVerificationRequired = input.emailVerificationRequired
  }
  if (emailVerificationRequired && (hasSmtpInput || input?.emailVerificationRequired === true)) {
    if (!smtpSettingsAreComplete(nextSmtp)) {
      throw createError({ statusCode: 400, message: '启用邮箱验证前必须配置 SMTP 服务器' })
    }
    if (nextSmtp.username && !smtpPasswordReplaced) decryptSmtpPassword(nextSmtp.encryptedPassword)
  }

  const loginCooldown = input?.loginCooldown === undefined
    ? current.loginCooldown
    : Math.min(86_400, Math.max(-1, Math.trunc(Number(input.loginCooldown) || 0)))

  db.exec('BEGIN IMMEDIATE')
  try {
    setSetting('game_account.login_cooldown', String(loginCooldown))
    if (hasSmtpInput) {
      setSetting(SMTP_HOST_SETTING, nextSmtp.host)
      setSetting(SMTP_PORT_SETTING, String(nextSmtp.port))
      setSetting(SMTP_SECURITY_SETTING, nextSmtp.security)
      setSetting(SMTP_USERNAME_SETTING, nextSmtp.username)
      setSetting(SMTP_FROM_ADDRESS_SETTING, nextSmtp.fromAddress)
      setSetting(SMTP_FROM_NAME_SETTING, nextSmtp.fromName)
      if (nextSmtp.encryptedPassword) setSetting(SMTP_PASSWORD_SETTING, nextSmtp.encryptedPassword)
      else deleteSetting(SMTP_PASSWORD_SETTING)
    }
    if (hasEmailTemplatesInput) setSetting(EMAIL_TEMPLATES_SETTING, JSON.stringify(nextEmailTemplates))
    setSetting(GAME_EMAIL_VERIFICATION_SETTING, emailVerificationRequired ? 'true' : 'false')
    if (current.emailVerificationRequired && !emailVerificationRequired) {
      run('DELETE FROM game_registration_sessions')
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return getAdminGameAccountSettings()
}

interface GameRegistrationSession {
  account: GameAccount
  startSession: boolean
  email: string | null
  verificationCodeHash: string
  codeExpiresAt: number
  resendAfter: number
  attempts: number
  expiresAt: number
}

function cleanupGameRegistrationSessions(now = Date.now()): void {
  run('DELETE FROM game_registration_sessions WHERE expires_at <= ?', now)
}

function registrationSessionIdentity(value: unknown): { id: string; hash: string } {
  const id = String(value ?? '').trim()
  if (!/^[a-f0-9]{64}$/i.test(id)) {
    throw createError({ statusCode: 400, message: '邮箱注册会话 ID 格式不正确' })
  }
  return { id, hash: tokenDigest(id) }
}

function mapGameRegistrationSession(row: Record<string, unknown>): GameRegistrationSession {
  return {
    account: {
      username: String(row.username ?? ''),
      usernameLower: String(row.username_lower ?? ''),
      uuid: row.uuid == null ? null : String(row.uuid),
      email: row.email == null ? null : String(row.email),
      password: String(row.password_hash ?? ''),
      lastIp: String(row.last_ip ?? ''),
      lastLoginIp: String(row.last_login_ip ?? ''),
      lastAuthenticatedDate: String(row.last_authenticated_date ?? '1970-01-01T00:00:00Z'),
      registrationDate: String(row.registration_date ?? new Date().toISOString()),
      loginTries: Number(row.login_tries ?? 0),
      lastKickedDate: String(row.last_kicked_date ?? '1970-01-01T00:00:00Z'),
      lastPosition: row.last_position == null ? null : String(row.last_position),
      inPlaceRespawnCount: Number(row.in_place_respawn_count ?? 0),
    },
    startSession: Number(row.start_session ?? 0) === 1,
    email: row.email == null ? null : String(row.email),
    verificationCodeHash: String(row.verification_code_hash ?? ''),
    codeExpiresAt: Number(row.code_expires_at ?? 0),
    resendAfter: Number(row.resend_after ?? 0),
    attempts: Number(row.attempts ?? 0),
    expiresAt: Number(row.expires_at ?? 0),
  }
}

function getGameRegistrationSession(sessionId: unknown): { identity: { id: string; hash: string }; session: GameRegistrationSession } {
  const identity = registrationSessionIdentity(sessionId)
  cleanupGameRegistrationSessions()
  const row = get('SELECT * FROM game_registration_sessions WHERE id_hash = ?', identity.hash)
  if (!row) throw createError({ statusCode: 410, message: '邮箱注册会话已失效，请重新发起注册' })
  return { identity, session: mapGameRegistrationSession(row) }
}

export function createGameRegistrationSession(
  account: GameAccount,
  startSession: boolean,
): { sessionId: string; expiresInSeconds: number } {
  const now = Date.now()
  cleanupGameRegistrationSessions(now)
  const sessionId = randomBytes(32).toString('hex')
  const expiresAt = now + GAME_REGISTRATION_SESSION_TTL_MS
  run('DELETE FROM game_registration_sessions WHERE username_lower = ?', account.usernameLower)
  run(`INSERT INTO game_registration_sessions
    (id_hash, username_lower, username, uuid, email, password_hash, last_ip, last_login_ip,
     last_authenticated_date, registration_date, login_tries, last_kicked_date, last_position,
     in_place_respawn_count, start_session, verification_code_hash, code_expires_at, resend_after,
     attempts, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    tokenDigest(sessionId), account.usernameLower, account.username, account.uuid, account.email,
    account.password, account.lastIp, account.lastLoginIp, account.lastAuthenticatedDate,
    account.registrationDate, account.loginTries, account.lastKickedDate, account.lastPosition,
    account.inPlaceRespawnCount, startSession ? 1 : 0, null, null, 0, 0, expiresAt, now)
  return { sessionId, expiresInSeconds: Math.floor(GAME_REGISTRATION_SESSION_TTL_MS / 1000) }
}

function registrationCodeDigest(sessionId: string, email: string, code: string): string {
  return createHash('sha256').update(`${sessionId}\0${email}\0${code}`, 'utf8').digest('hex')
}

function requireGameEmailAvailable(email: string, usernameLower: string): void {
  const owner = get(
    'SELECT username_lower FROM game_accounts WHERE email COLLATE NOCASE = ? LIMIT 1',
    email,
  )
  if (owner && String(owner.username_lower) !== usernameLower) {
    throw createError({ statusCode: 409, message: '该邮箱已绑定其他游戏账户' })
  }
}

export function issueGameRegistrationEmailCode(
  sessionIdValue: unknown,
  emailValue: unknown,
): { code: string; email: string; username: string; expiresInSeconds: number; resendAfterSeconds: number } {
  const { identity, session } = getGameRegistrationSession(sessionIdValue)
  const email = requireEmailAddress(emailValue)
  requireGameEmailAvailable(email, session.account.usernameLower)
  const now = Date.now()
  if (session.resendAfter > now) {
    throw createError({
      statusCode: 429,
      message: '邮箱验证码发送过于频繁',
      data: { retryAfterSeconds: Math.ceil((session.resendAfter - now) / 1000) },
    })
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const codeExpiresAt = Math.min(session.expiresAt, now + GAME_EMAIL_CODE_TTL_MS)
  const update = run(`UPDATE game_registration_sessions
       SET email = ?, verification_code_hash = ?, code_expires_at = ?, resend_after = ?, attempts = 0
       WHERE id_hash = ? AND resend_after <= ?`,
    email, registrationCodeDigest(identity.id, email, code), codeExpiresAt,
    now + GAME_EMAIL_RESEND_DELAY_MS, identity.hash, now)
  if (Number(update.changes ?? 0) !== 1) {
    const latest = get('SELECT resend_after FROM game_registration_sessions WHERE id_hash = ?', identity.hash)
    const retryAfterSeconds = Math.max(1, Math.ceil((Number(latest?.resend_after ?? now) - now) / 1000))
    throw createError({
      statusCode: 429,
      message: '邮箱验证码发送过于频繁',
      data: { retryAfterSeconds },
    })
  }
  return {
    code,
    email,
    username: session.account.username,
    expiresInSeconds: Math.max(1, Math.ceil((codeExpiresAt - now) / 1000)),
    resendAfterSeconds: Math.ceil(GAME_EMAIL_RESEND_DELAY_MS / 1000),
  }
}

export function revokeGameRegistrationEmailCode(sessionIdValue: unknown, email: string, code: string): void {
  const identity = registrationSessionIdentity(sessionIdValue)
  run(`UPDATE game_registration_sessions
       SET email = NULL, verification_code_hash = NULL, code_expires_at = NULL, resend_after = 0, attempts = 0
       WHERE id_hash = ? AND verification_code_hash = ?`,
    identity.hash, registrationCodeDigest(identity.id, email, code))
}

export function completeGameRegistration(
  sessionIdValue: unknown,
  codeValue: unknown,
): { account: GameAccount; startSession: boolean } {
  const code = String(codeValue ?? '').trim()
  if (!/^\d{6}$/.test(code)) {
    throw createError({ statusCode: 400, message: '邮箱验证码格式不正确' })
  }
  const { identity, session } = getGameRegistrationSession(sessionIdValue)
  if (!session.email || !session.verificationCodeHash) {
    throw createError({ statusCode: 409, message: '请先发送邮箱验证码' })
  }
  const now = Date.now()
  if (session.codeExpiresAt <= now) {
    run(`UPDATE game_registration_sessions
         SET email = NULL, verification_code_hash = NULL, code_expires_at = NULL, resend_after = 0, attempts = 0
         WHERE id_hash = ?`, identity.hash)
    throw createError({ statusCode: 410, message: '邮箱验证码已过期，请重新发送' })
  }
  const actualHash = registrationCodeDigest(identity.id, session.email, code)
  if (!safeEqualHex(actualHash, session.verificationCodeHash)) {
    run('UPDATE game_registration_sessions SET attempts = attempts + 1 WHERE id_hash = ?', identity.hash)
    const attempts = Number(get('SELECT attempts FROM game_registration_sessions WHERE id_hash = ?', identity.hash)?.attempts ?? GAME_EMAIL_MAX_ATTEMPTS)
    if (attempts >= GAME_EMAIL_MAX_ATTEMPTS) {
      run('DELETE FROM game_registration_sessions WHERE id_hash = ?', identity.hash)
    }
    throw createError({
      statusCode: 400,
      message: attempts >= GAME_EMAIL_MAX_ATTEMPTS ? '邮箱验证码错误次数过多，请重新注册' : '邮箱验证码错误',
      data: { remainingAttempts: Math.max(0, GAME_EMAIL_MAX_ATTEMPTS - attempts) },
    })
  }

  const account: GameAccount = {
    ...session.account,
    email: session.email,
    lastAuthenticatedDate: session.startSession
      ? new Date().toISOString()
      : session.account.lastAuthenticatedDate,
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    const latest = get('SELECT verification_code_hash FROM game_registration_sessions WHERE id_hash = ?', identity.hash)
    if (!latest || String(latest.verification_code_hash ?? '') !== session.verificationCodeHash) {
      throw createError({ statusCode: 409, message: '邮箱注册会话状态已变化，请重试' })
    }
    if (getGameAccount(account.username)?.password) {
      throw createError({ statusCode: 409, message: '账户已注册' })
    }
    requireGameEmailAvailable(session.email, account.usernameLower)
    upsertGameAccount(account)
    run('DELETE FROM game_registration_sessions WHERE id_hash = ?', identity.hash)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { account, startSession: session.startSession }
}

interface GameEmailChangeSession {
  usernameLower: string
  email: string
  verificationCodeHash: string
  codeExpiresAt: number
  resendAfter: number
  attempts: number
  expiresAt: number
}

function cleanupGameEmailChangeSessions(now = Date.now()): void {
  run('DELETE FROM game_email_change_sessions WHERE expires_at <= ?', now)
}

function emailChangeSessionIdentity(value: unknown): { id: string; hash: string } {
  const id = String(value ?? '').trim()
  if (!/^[a-f0-9]{64}$/i.test(id)) {
    throw createError({ statusCode: 400, message: '换绑邮箱会话 ID 格式不正确' })
  }
  return { id, hash: tokenDigest(id) }
}

function emailChangeCodeDigest(sessionId: string, email: string, code: string): string {
  return createHash('sha256')
    .update(`email-change\0${sessionId}\0${email}\0${code}`, 'utf8')
    .digest('hex')
}

function mapGameEmailChangeSession(row: Record<string, unknown>): GameEmailChangeSession {
  return {
    usernameLower: String(row.username_lower ?? ''),
    email: String(row.email ?? ''),
    verificationCodeHash: String(row.verification_code_hash ?? ''),
    codeExpiresAt: Number(row.code_expires_at ?? 0),
    resendAfter: Number(row.resend_after ?? 0),
    attempts: Number(row.attempts ?? 0),
    expiresAt: Number(row.expires_at ?? 0),
  }
}

function getGameEmailChangeSession(
  sessionIdValue: unknown,
): { identity: { id: string; hash: string }; session: GameEmailChangeSession } {
  const identity = emailChangeSessionIdentity(sessionIdValue)
  cleanupGameEmailChangeSessions()
  const row = get('SELECT * FROM game_email_change_sessions WHERE id_hash = ?', identity.hash)
  if (!row) throw createError({ statusCode: 410, message: '换绑邮箱会话已失效，请重新发送验证码' })
  return { identity, session: mapGameEmailChangeSession(row) }
}

export function issueGameEmailChangeCode(
  authenticatedAccount: GameAccount,
  passwordValue: unknown,
  emailValue: unknown,
): {
    code: string
    email: string
    username: string
    sessionId: string
    expiresInSeconds: number
    resendAfterSeconds: number
  } {
  const current = getGameAccount(authenticatedAccount.username)
  if (!current?.password || current.usernameLower !== authenticatedAccount.usernameLower) {
    throw createError({ statusCode: 404, message: '游戏账户不存在或尚未注册' })
  }
  if (!verifyGamePassword(String(passwordValue ?? ''), current.password)) {
    throw createError({ statusCode: 401, message: '当前密码错误' })
  }

  const email = requireEmailAddress(emailValue)
  if (current.email?.toLocaleLowerCase('en-US') === email) {
    throw createError({ statusCode: 409, message: '新邮箱不能与当前绑定邮箱相同' })
  }
  requireGameEmailAvailable(email, current.usernameLower)

  const now = Date.now()
  cleanupGameEmailChangeSessions(now)
  db.exec('BEGIN IMMEDIATE')
  try {
    const existing = get(
      'SELECT resend_after FROM game_email_change_sessions WHERE username_lower = ?',
      current.usernameLower,
    )
    const resendAfter = Number(existing?.resend_after ?? 0)
    if (resendAfter > now) {
      throw createError({
        statusCode: 429,
        message: '换绑邮箱验证码发送过于频繁',
        data: { retryAfterSeconds: Math.ceil((resendAfter - now) / 1000) },
      })
    }
    requireGameEmailAvailable(email, current.usernameLower)

    const sessionId = randomBytes(32).toString('hex')
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const expiresAt = now + GAME_EMAIL_CHANGE_SESSION_TTL_MS
    run('DELETE FROM game_email_change_sessions WHERE username_lower = ?', current.usernameLower)
    run(`INSERT INTO game_email_change_sessions
      (id_hash, username_lower, email, verification_code_hash, code_expires_at,
       resend_after, attempts, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      tokenDigest(sessionId), current.usernameLower, email,
      emailChangeCodeDigest(sessionId, email, code), expiresAt,
      now + GAME_EMAIL_RESEND_DELAY_MS, expiresAt, now)
    db.exec('COMMIT')
    return {
      code,
      email,
      username: current.username,
      sessionId,
      expiresInSeconds: Math.floor(GAME_EMAIL_CHANGE_SESSION_TTL_MS / 1000),
      resendAfterSeconds: Math.ceil(GAME_EMAIL_RESEND_DELAY_MS / 1000),
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function revokeGameEmailChangeCode(
  sessionIdValue: unknown,
  email: string,
  code: string,
): void {
  const identity = emailChangeSessionIdentity(sessionIdValue)
  run(`DELETE FROM game_email_change_sessions
       WHERE id_hash = ? AND verification_code_hash = ?`,
    identity.hash, emailChangeCodeDigest(identity.id, email, code))
}

export function completeGameEmailChange(
  authenticatedAccount: GameAccount,
  sessionIdValue: unknown,
  codeValue: unknown,
): GameAccount {
  const code = String(codeValue ?? '').trim()
  if (!/^\d{6}$/.test(code)) {
    throw createError({ statusCode: 400, message: '邮箱验证码格式不正确' })
  }
  const { identity, session } = getGameEmailChangeSession(sessionIdValue)
  if (session.usernameLower !== authenticatedAccount.usernameLower) {
    throw createError({ statusCode: 403, message: '换绑邮箱会话不属于当前账户' })
  }

  const now = Date.now()
  if (session.codeExpiresAt <= now || session.expiresAt <= now) {
    run('DELETE FROM game_email_change_sessions WHERE id_hash = ?', identity.hash)
    throw createError({ statusCode: 410, message: '换绑邮箱验证码已过期，请重新发送' })
  }

  const actualHash = emailChangeCodeDigest(identity.id, session.email, code)
  if (!safeEqualHex(actualHash, session.verificationCodeHash)) {
    run('UPDATE game_email_change_sessions SET attempts = attempts + 1 WHERE id_hash = ?', identity.hash)
    const attempts = Number(get(
      'SELECT attempts FROM game_email_change_sessions WHERE id_hash = ?',
      identity.hash,
    )?.attempts ?? GAME_EMAIL_MAX_ATTEMPTS)
    if (attempts >= GAME_EMAIL_MAX_ATTEMPTS) {
      run('DELETE FROM game_email_change_sessions WHERE id_hash = ?', identity.hash)
    }
    throw createError({
      statusCode: 400,
      message: attempts >= GAME_EMAIL_MAX_ATTEMPTS
        ? '邮箱验证码错误次数过多，请重新发送'
        : '邮箱验证码错误',
      data: { remainingAttempts: Math.max(0, GAME_EMAIL_MAX_ATTEMPTS - attempts) },
    })
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    const latest = get('SELECT * FROM game_email_change_sessions WHERE id_hash = ?', identity.hash)
    if (!latest
        || String(latest.username_lower ?? '') !== authenticatedAccount.usernameLower
        || String(latest.verification_code_hash ?? '') !== session.verificationCodeHash) {
      throw createError({ statusCode: 409, message: '换绑邮箱会话状态已变化，请重试' })
    }
    if (Number(latest.code_expires_at ?? 0) <= Date.now()
        || Number(latest.expires_at ?? 0) <= Date.now()) {
      run('DELETE FROM game_email_change_sessions WHERE id_hash = ?', identity.hash)
      throw createError({ statusCode: 410, message: '换绑邮箱验证码已过期，请重新发送' })
    }

    const current = getGameAccount(authenticatedAccount.username)
    if (!current?.password || current.usernameLower !== authenticatedAccount.usernameLower) {
      throw createError({ statusCode: 404, message: '游戏账户不存在或尚未注册' })
    }
    if (current.email?.toLocaleLowerCase('en-US') === session.email) {
      throw createError({ statusCode: 409, message: '该邮箱已经绑定到当前账户' })
    }
    requireGameEmailAvailable(session.email, current.usernameLower)
    run('UPDATE game_accounts SET email = ?, updated_at = ? WHERE username_lower = ?',
      session.email, Date.now(), current.usernameLower)
    run('DELETE FROM game_email_change_sessions WHERE username_lower = ?', current.usernameLower)
    db.exec('COMMIT')
    return { ...current, email: session.email }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

interface GamePasswordResetSession {
  usernameLower: string
  email: string
  verificationCodeHash: string
  codeExpiresAt: number
  resendAfter: number
  attempts: number
  expiresAt: number
}

function cleanupGamePasswordResetSessions(now = Date.now()): void {
  run('DELETE FROM game_password_reset_sessions WHERE expires_at <= ?', now)
}

function passwordResetSessionIdentity(value: unknown): { id: string; hash: string } {
  const id = String(value ?? '').trim()
  if (!/^[a-f0-9]{64}$/i.test(id)) {
    throw createError({ statusCode: 400, message: '找回密码会话 ID 格式不正确' })
  }
  return { id, hash: tokenDigest(id) }
}

function passwordResetCodeDigest(sessionId: string, email: string, code: string): string {
  return createHash('sha256')
    .update(`password-reset\0${sessionId}\0${email}\0${code}`, 'utf8')
    .digest('hex')
}

function mapGamePasswordResetSession(row: Record<string, unknown>): GamePasswordResetSession {
  return {
    usernameLower: String(row.username_lower ?? ''),
    email: String(row.email ?? ''),
    verificationCodeHash: String(row.verification_code_hash ?? ''),
    codeExpiresAt: Number(row.code_expires_at ?? 0),
    resendAfter: Number(row.resend_after ?? 0),
    attempts: Number(row.attempts ?? 0),
    expiresAt: Number(row.expires_at ?? 0),
  }
}

function getGamePasswordResetSession(
  sessionIdValue: unknown,
): { identity: { id: string; hash: string }; session: GamePasswordResetSession } {
  const identity = passwordResetSessionIdentity(sessionIdValue)
  cleanupGamePasswordResetSessions()
  const row = get('SELECT * FROM game_password_reset_sessions WHERE id_hash = ?', identity.hash)
  if (!row) throw createError({ statusCode: 410, message: '找回密码会话已失效，请重新发送验证码' })
  return { identity, session: mapGamePasswordResetSession(row) }
}

export function issueGamePasswordResetEmailCode(
  usernameValue: unknown,
  emailValue: unknown,
): {
    code: string
    email: string
    username: string
    sessionId: string
    expiresInSeconds: number
    resendAfterSeconds: number
  } {
  const username = String(usernameValue ?? '').trim()
  const usernameLower = username.toLocaleLowerCase('en-US')
  const email = requireEmailAddress(emailValue)
  const account = getGameAccount(username)
  if (!account?.password) {
    throw createError({ statusCode: 404, message: '游戏账户不存在或尚未注册' })
  }
  if (!account.email) {
    throw createError({ statusCode: 409, message: '该游戏账户未绑定找回邮箱' })
  }
  if (account.email.toLocaleLowerCase('en-US') !== email) {
    throw createError({ statusCode: 403, message: '邮箱与该游戏账户绑定邮箱不匹配' })
  }

  const now = Date.now()
  cleanupGamePasswordResetSessions(now)
  db.exec('BEGIN IMMEDIATE')
  try {
    const existing = get(
      'SELECT resend_after FROM game_password_reset_sessions WHERE username_lower = ?',
      usernameLower,
    )
    const resendAfter = Number(existing?.resend_after ?? 0)
    if (resendAfter > now) {
      throw createError({
        statusCode: 429,
        message: '找回密码验证码发送过于频繁',
        data: { retryAfterSeconds: Math.ceil((resendAfter - now) / 1000) },
      })
    }

    const sessionId = randomBytes(32).toString('hex')
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const expiresAt = now + GAME_PASSWORD_RESET_SESSION_TTL_MS
    run('DELETE FROM game_password_reset_sessions WHERE username_lower = ?', usernameLower)
    run(`INSERT INTO game_password_reset_sessions
      (id_hash, username_lower, email, verification_code_hash, code_expires_at,
       resend_after, attempts, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      tokenDigest(sessionId), usernameLower, email,
      passwordResetCodeDigest(sessionId, email, code), expiresAt,
      now + GAME_EMAIL_RESEND_DELAY_MS, expiresAt, now)
    db.exec('COMMIT')
    return {
      code,
      email,
      username: account.username,
      sessionId,
      expiresInSeconds: Math.floor(GAME_PASSWORD_RESET_SESSION_TTL_MS / 1000),
      resendAfterSeconds: Math.ceil(GAME_EMAIL_RESEND_DELAY_MS / 1000),
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function revokeGamePasswordResetEmailCode(
  sessionIdValue: unknown,
  email: string,
  code: string,
): void {
  const identity = passwordResetSessionIdentity(sessionIdValue)
  run(`DELETE FROM game_password_reset_sessions
       WHERE id_hash = ? AND verification_code_hash = ?`,
    identity.hash, passwordResetCodeDigest(identity.id, email, code))
}

export function completeGamePasswordReset(
  sessionIdValue: unknown,
  codeValue: unknown,
  newPasswordValue: unknown,
): { username: string } {
  const code = String(codeValue ?? '').trim()
  if (!/^\d{6}$/.test(code)) {
    throw createError({ statusCode: 400, message: '邮箱验证码格式不正确' })
  }
  const newPassword = String(newPasswordValue ?? '')
  if (newPassword.length < 4 || newPassword.length > 128) {
    throw createError({ statusCode: 400, message: '新密码长度需要为 4 至 128 位' })
  }

  const { identity, session } = getGamePasswordResetSession(sessionIdValue)
  const now = Date.now()
  if (session.codeExpiresAt <= now || session.expiresAt <= now) {
    run('DELETE FROM game_password_reset_sessions WHERE id_hash = ?', identity.hash)
    throw createError({ statusCode: 410, message: '找回密码验证码已过期，请重新发送' })
  }

  const actualHash = passwordResetCodeDigest(identity.id, session.email, code)
  if (!safeEqualHex(actualHash, session.verificationCodeHash)) {
    run('UPDATE game_password_reset_sessions SET attempts = attempts + 1 WHERE id_hash = ?', identity.hash)
    const attempts = Number(get(
      'SELECT attempts FROM game_password_reset_sessions WHERE id_hash = ?',
      identity.hash,
    )?.attempts ?? GAME_EMAIL_MAX_ATTEMPTS)
    if (attempts >= GAME_EMAIL_MAX_ATTEMPTS) {
      run('DELETE FROM game_password_reset_sessions WHERE id_hash = ?', identity.hash)
    }
    throw createError({
      statusCode: 400,
      message: attempts >= GAME_EMAIL_MAX_ATTEMPTS
        ? '邮箱验证码错误次数过多，请重新发送'
        : '邮箱验证码错误',
      data: { remainingAttempts: Math.max(0, GAME_EMAIL_MAX_ATTEMPTS - attempts) },
    })
  }

  const passwordHash = hashGamePassword(newPassword)
  db.exec('BEGIN IMMEDIATE')
  try {
    const latest = get('SELECT * FROM game_password_reset_sessions WHERE id_hash = ?', identity.hash)
    if (!latest || String(latest.verification_code_hash ?? '') !== session.verificationCodeHash) {
      throw createError({ statusCode: 409, message: '找回密码会话状态已变化，请重试' })
    }
    if (Number(latest.code_expires_at ?? 0) <= Date.now()
        || Number(latest.expires_at ?? 0) <= Date.now()) {
      run('DELETE FROM game_password_reset_sessions WHERE id_hash = ?', identity.hash)
      throw createError({ statusCode: 410, message: '找回密码验证码已过期，请重新发送' })
    }
    const account = get('SELECT username, email, password FROM game_accounts WHERE username_lower = ?',
      session.usernameLower)
    if (!account || !String(account.password ?? '')) {
      throw createError({ statusCode: 404, message: '游戏账户不存在或尚未注册' })
    }
    if (String(account.email ?? '').toLocaleLowerCase('en-US') !== session.email) {
      throw createError({ statusCode: 409, message: '账户绑定邮箱已变化，请重新发送验证码' })
    }

    run(`UPDATE game_accounts
         SET password = ?, login_tries = 0, last_kicked_date = ?, updated_at = ?
         WHERE username_lower = ?`,
      passwordHash, '1970-01-01T00:00:00Z', now, session.usernameLower)
    run('DELETE FROM game_sessions WHERE username_lower = ?', session.usernameLower)
    run('DELETE FROM game_password_reset_sessions WHERE username_lower = ?', session.usernameLower)
    run('DELETE FROM game_email_change_sessions WHERE username_lower = ?', session.usernameLower)
    db.exec('COMMIT')
    return { username: String(account.username ?? session.usernameLower) }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function hashAdminPassword(password: string): string {
  const iterations = 600_000
  const salt = randomBytes(16)
  const digest = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  return `PBKDF2:${iterations}:${salt.toString('base64')}:${digest.toString('base64')}`
}

export function isAdminInitialized(): boolean {
  // 只要已经存在后台用户就禁止重新初始化；入口损坏时应失败关闭，而不是开放公共重置入口。
  return Boolean(get('SELECT 1 FROM admin_users LIMIT 1'))
}

export function requireValidAdminEntry(value: unknown): string {
  const entry = String(value ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (!ADMIN_ENTRY_RE.test(entry) || RESERVED_ADMIN_ENTRIES.has(entry.toLowerCase())) {
    throw createError({ statusCode: 400, statusMessage: '入口需要为 12 至 64 位字母、数字、下划线或连字符，且不能与现有页面冲突' })
  }
  return entry
}

export function initializeAdmin(
  usernameValue: unknown,
  password: unknown,
  entryValue: unknown,
  turnstileSiteKey: unknown,
  turnstileSecret: unknown,
  turnstileHostnames: unknown,
  gameApiKey: unknown,
): string {
  const username = requireAdminUsername(usernameValue)
  const rawPassword = requireAdminPassword(password, '后台密码')
  const entry = requireValidAdminEntry(entryValue)
  const normalizedGameApiKey = requireGameApiKeyValue(gameApiKey)

  // 已初始化后先走廉价检查，避免公开的初始化接口被用于反复触发高成本密码哈希。
  if (isAdminInitialized()) {
    throw createError({ statusCode: 409, statusMessage: '后台已经完成初始化' })
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    if (isAdminInitialized()) {
      throw createError({ statusCode: 409, statusMessage: '后台已经完成初始化' })
    }
    deleteSetting(ADMIN_PASSWORD_SETTING)
    setSetting(ADMIN_ENTRY_SETTING, entry)
    setTurnstileConfig(turnstileSiteKey, turnstileSecret, turnstileHostnames)
    setSetting(GAME_API_KEY_SETTING, normalizedGameApiKey)
    run('DELETE FROM sessions')
    run('DELETE FROM admin_users')
    const passwordHash = hashAdminPassword(rawPassword)
    run(
      'INSERT INTO admin_users (username, password_hash, avatar, is_owner, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, 1, ?, ?)',
      username, passwordHash, DEFAULT_ADMIN_AVATAR, Date.now(), Date.now(),
    )
    db.exec('COMMIT')
    return entry
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function updateAdminPassword(user: AdminUser, oldPassword: string, newPassword: string): void {
  if (!verifyUserPassword(user.username, oldPassword)) throw createError({ statusCode: 401, statusMessage: '当前密码错误' })
  const password = requireAdminPassword(newPassword, '新密码')
  run('UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?', hashAdminPassword(password), Date.now(), user.id)
  if (user.isOwner) deleteSetting(ADMIN_PASSWORD_SETTING)
  run('DELETE FROM sessions WHERE user_id = ?', user.id)
}

export function verifyUserPassword(username: string, password: string): boolean {
  const row = get('SELECT password_hash FROM admin_users WHERE username = ? AND is_active = 1', username)
  return Boolean(row && verifyGamePassword(password, String(row.password_hash ?? '')))
}

export function getAdminEntry(): string {
  const entry = getSetting(ADMIN_ENTRY_SETTING)?.trim() || ''
  if (!ADMIN_ENTRY_RE.test(entry) || RESERVED_ADMIN_ENTRIES.has(entry.toLowerCase())) {
    throw createError({ statusCode: 503, statusMessage: '后台安全入口未正确配置' })
  }
  return entry
}

export function setAdminEntry(entry: string): void {
  setSetting(ADMIN_ENTRY_SETTING, requireValidAdminEntry(entry))
}

export function hashGamePassword(password: string): string {
  const iterations = 600_000
  const salt = randomBytes(16)
  const digest = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  return `PBKDF2:${iterations}:${salt.toString('base64')}:${digest.toString('base64')}`
}

export function verifyGamePassword(password: string, storedHash: string): boolean {
  try {
    const [algorithm, iterationText, saltText, digestText] = storedHash.split(':')
    if (algorithm !== 'PBKDF2') return false
    const iterations = Number(iterationText)
    const salt = Buffer.from(saltText, 'base64')
    const expected = Buffer.from(digestText, 'base64')
    if (!Number.isInteger(iterations) || iterations < 1 || !salt.length || !expected.length) return false
    const actual = pbkdf2Sync(password, salt, iterations, expected.length, 'sha256')
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function upsertGameCosmetic(uuid: string, slot: string, data: Uint8Array) {
  const digest = createHash('sha256').update(data).digest('hex')
  run(`INSERT INTO game_cosmetics (uuid, slot, data, sha256, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(uuid, slot) DO UPDATE SET data = excluded.data, sha256 = excluded.sha256, updated_at = excluded.updated_at`,
    uuid, slot, data, digest, Date.now())
  return { sha256: digest }
}

export function getGameCosmetic(uuid: string, slot: string): { data: Buffer; sha256: string } | undefined {
  const row = get('SELECT data, sha256 FROM game_cosmetics WHERE uuid = ? AND slot = ?', uuid, slot)
  if (!row) return undefined
  return { data: Buffer.from(row.data as Uint8Array), sha256: String(row.sha256) }
}

export function listGameCosmeticSlots(uuid: string): { slot: string; sha256: string }[] {
  return all('SELECT slot, sha256 FROM game_cosmetics WHERE uuid = ?', uuid).map((row) => ({
    slot: String(row.slot), sha256: String(row.sha256),
  }))
}

export interface GameCosmeticMeta {
  uuid: string
  slot: string
  sha256: string
  bytes: number
  width: number
  height: number
  updatedAt: number
}

/**
 * 后台外观总览用的元数据：只取 PNG 头部的宽高，不把图片数据读进内存。
 * IHDR 固定位于签名之后，宽高分别是第 16、20 字节起的大端 32 位整数。
 */
export function listGameCosmeticMeta(): GameCosmeticMeta[] {
  return all(`SELECT uuid, slot, sha256, updated_at, length(data) AS bytes,
                     substr(data, 17, 4) AS width_bytes, substr(data, 21, 4) AS height_bytes
              FROM game_cosmetics ORDER BY uuid, slot`).map((row) => ({
    uuid: String(row.uuid ?? '').toLowerCase(),
    slot: String(row.slot ?? ''),
    sha256: String(row.sha256 ?? ''),
    bytes: Number(row.bytes ?? 0),
    width: bigEndianUint32(row.width_bytes),
    height: bigEndianUint32(row.height_bytes),
    updatedAt: Number(row.updated_at ?? 0),
  }))
}

function bigEndianUint32(value: unknown): number {
  if (!(value instanceof Uint8Array) || value.length < 4) return 0
  return Buffer.from(value).readUInt32BE(0)
}

export function deleteGameCosmetics(uuid: string) {
  run('DELETE FROM game_cosmetics WHERE uuid = ?', uuid)
}

export function replaceGameCosmetics(uuid: string, slots: Record<string, Uint8Array>) {
  db.exec('BEGIN IMMEDIATE')
  try {
    run('DELETE FROM game_cosmetics WHERE uuid = ?', uuid)
    for (const [slot, data] of Object.entries(slots)) {
      if (data.length) upsertGameCosmetic(uuid, slot, data)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

// ============================================================================
// 正版档案缓存（后台外观页在本地无上传时回退查询 Mojang）
// ----------------------------------------------------------------------------
// 服务器跑离线模式，账户表里的 UUID 是离线 UUID，判断是否正版只能按玩家代号
// 去 Mojang 查同名档案。查询按玩家代号缓存，命中缓存不再外呼。
// ============================================================================

export type MojangProfileStatus = 'premium' | 'missing' | 'error'

export interface MojangProfileCache {
  usernameLower: string
  username: string
  profileUuid: string | null
  skinHash: string
  capeHash: string
  model: string
  status: MojangProfileStatus
  message: string
  checkedAt: number
  /** 超过 TTL 的记录仍然返回，前端可据此提示信息已过期。 */
  stale: boolean
}

function mapMojangProfile(row: Record<string, unknown>): MojangProfileCache {
  const status = String(row.status ?? 'error')
  const checkedAt = Number(row.checked_at ?? 0)
  const normalized: MojangProfileStatus = status === 'premium' || status === 'missing' ? status : 'error'
  const ttl = normalized === 'error' ? MOJANG_ERROR_TTL_MS : MOJANG_PROFILE_TTL_MS
  return {
    usernameLower: String(row.username_lower ?? ''),
    username: String(row.username ?? ''),
    profileUuid: row.profile_uuid == null || String(row.profile_uuid).trim() === ''
      ? null
      : String(row.profile_uuid),
    skinHash: String(row.skin_hash ?? ''),
    capeHash: String(row.cape_hash ?? ''),
    model: String(row.model ?? ''),
    status: normalized,
    message: String(row.message ?? ''),
    checkedAt,
    stale: !Number.isFinite(checkedAt) || checkedAt + ttl <= Date.now(),
  }
}

export function getMojangProfileCache(username: string): MojangProfileCache | undefined {
  const key = username.trim().toLocaleLowerCase('en-US')
  const row = get('SELECT * FROM mojang_profiles WHERE username_lower = ?', key)
  return row ? mapMojangProfile(row) : undefined
}

export function listMojangProfileCache(): MojangProfileCache[] {
  return all('SELECT * FROM mojang_profiles').map(mapMojangProfile)
}

export function upsertMojangProfileCache(profile: {
  username: string
  profileUuid: string | null
  skinHash: string
  capeHash: string
  model: string
  status: MojangProfileStatus
  message: string
}): MojangProfileCache {
  const key = profile.username.trim().toLocaleLowerCase('en-US')
  run(`INSERT INTO mojang_profiles
         (username_lower, username, profile_uuid, skin_hash, cape_hash, model, status, message, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(username_lower) DO UPDATE SET
         username = excluded.username, profile_uuid = excluded.profile_uuid,
         skin_hash = excluded.skin_hash, cape_hash = excluded.cape_hash, model = excluded.model,
         status = excluded.status, message = excluded.message, checked_at = excluded.checked_at`,
    key, profile.username.trim(), profile.profileUuid, profile.skinHash, profile.capeHash,
    profile.model, profile.status, profile.message.slice(0, 200), Date.now())
  return getMojangProfileCache(key)!
}

// ============================================================================
// 邮件系统（原模组 SentMailRepository + MailDataStorage 的权威存储）
// ----------------------------------------------------------------------------
// game_mails      —— 邮件正文仓库，等价于旧 data.json 的 sent_mails 块
// game_mail_refs  —— 每玩家收件箱引用，等价于旧 box/<player-uuid>.json
// 接收范围（NONADMIN / ROLE）需要 LuckPerms，仍由模组解析后把收件人 UUID 传进来。
// ============================================================================

export interface GameMail {
  id: string
  type: MailType
  sender: string
  targets: MailTargetSpec[]
  scopeSummary: string
  title: string
  body: string
  createdTime: number
  expireTime: number | null
  claimed: boolean
  hidden: boolean
  attachments: MailAttachment[]
}

export interface GameMailRef {
  mailId: string
  read: boolean
  starred: boolean
  claimed: boolean
}

/** 发布 / 编辑邮件时的字段集合，不含运行期状态（claimed / hidden）。 */
export interface GameMailInput {
  type: MailType
  sender: string
  targets: MailTargetSpec[]
  scopeSummary: string
  title: string
  body: string
  expireTime: number | null
  attachments: MailAttachment[]
}

export interface GameMailEditState {
  canEdit: boolean
  needHidden: boolean
  denyReason: string
}

function parseJsonArray<T>(value: unknown): T[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'))
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    // 单行数据损坏不应让整个信箱查询失败；缺失的部分按空列表处理。
    return []
  }
}

function mapGameMail(row: Record<string, unknown>): GameMail {
  const expireTime = row.expire_time == null ? null : Number(row.expire_time)
  return {
    id: String(row.id ?? ''),
    type: String(row.type ?? 'NOTICE') as MailType,
    sender: String(row.sender ?? ''),
    targets: parseJsonArray<MailTargetSpec>(row.targets),
    scopeSummary: String(row.scope_summary ?? ''),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    createdTime: Number(row.created_time ?? 0),
    expireTime: expireTime != null && Number.isFinite(expireTime) ? expireTime : null,
    claimed: Number(row.claimed ?? 0) === 1,
    hidden: Number(row.hidden ?? 0) === 1,
    attachments: parseJsonArray<MailAttachment>(row.attachments),
  }
}

function mapGameMailRef(row: Record<string, unknown>): GameMailRef {
  return {
    mailId: String(row.mail_id ?? ''),
    read: Number(row.read ?? 0) === 1,
    starred: Number(row.starred ?? 0) === 1,
    claimed: Number(row.claimed ?? 0) === 1,
  }
}

export function gameMailWire(mail: GameMail) {
  return {
    id: mail.id,
    type: mail.type,
    sender: mail.sender,
    targets: mail.targets,
    scope_summary: mail.scopeSummary,
    title: mail.title,
    body: mail.body,
    created_time: mail.createdTime,
    expire_time: mail.expireTime,
    claimed: mail.claimed,
    hidden: mail.hidden,
    attachments: mail.attachments.map((attachment) => ({
      type: attachment.type,
      data: attachment.data,
      amount: attachment.amount,
      item_nbt: attachment.itemNbt,
    })),
  }
}

/** 已发送列表只需要摘要字段，不下发正文与附件。 */
export function gameMailSummaryWire(mail: GameMail) {
  return {
    id: mail.id,
    type: mail.type,
    title: mail.title,
    scope_summary: mail.scopeSummary,
    created_time: mail.createdTime,
    expire_time: mail.expireTime,
    sender: mail.sender,
  }
}

export function gameMailRefWire(ref: GameMailRef) {
  return { mail_id: ref.mailId, read: ref.read, starred: ref.starred, claimed: ref.claimed }
}

function gameMailIsExpired(mail: GameMail, now = Date.now()): boolean {
  return mail.expireTime != null && now > mail.expireTime
}

/** 与模组 {@code MailManager.computeCanEdit} 完全一致的编辑前置判定。 */
export function computeGameMailEditState(mail: GameMail): GameMailEditState {
  if (mail.attachments.length === 0) return { canEdit: true, needHidden: false, denyReason: '' }
  if (mail.claimed) {
    return { canEdit: false, needHidden: true, denyReason: '已有玩家领取过附件，不可编辑，仅可撤回' }
  }
  return { canEdit: true, needHidden: true, denyReason: '' }
}

export function getGameMail(id: string): GameMail | undefined {
  const row = get('SELECT * FROM game_mails WHERE id = ?', id)
  return row ? mapGameMail(row) : undefined
}

export function listGameMails(): GameMail[] {
  return all('SELECT * FROM game_mails ORDER BY created_time DESC, id').map(mapGameMail)
}

export function listGameMailRecipients(mailId: string): string[] {
  return all('SELECT player_uuid FROM game_mail_refs WHERE mail_id = ?', mailId)
    .map((row) => String(row.player_uuid))
}

export function getGameMailRef(mailId: string, playerUuid: string): GameMailRef | undefined {
  const row = get('SELECT * FROM game_mail_refs WHERE mail_id = ? AND player_uuid = ?', mailId, playerUuid)
  return row ? mapGameMailRef(row) : undefined
}

/** 删除指向已撤回邮件的悬空引用，返回受影响的引用条数。 */
function pruneDanglingGameMailRefs(playerUuid?: string): number {
  const result = playerUuid
    ? run(`DELETE FROM game_mail_refs
           WHERE player_uuid = ? AND mail_id NOT IN (SELECT id FROM game_mails)`, playerUuid)
    : run('DELETE FROM game_mail_refs WHERE mail_id NOT IN (SELECT id FROM game_mails)')
  return Number(result.changes ?? 0)
}

/**
 * 加载收件箱前的清理，语义对齐旧 {@code MailDataStorage.load}：
 * 悬空引用一律剔除；仅当配置关闭「过期后保留星标」时，才连过期未星标的引用一起剔除。
 */
function cleanupGameMailbox(playerUuid: string, keepStarred: boolean): void {
  pruneDanglingGameMailRefs(playerUuid)
  if (keepStarred) return
  run(`DELETE FROM game_mail_refs
       WHERE player_uuid = ? AND starred = 0 AND mail_id IN (
         SELECT id FROM game_mails WHERE expire_time IS NOT NULL AND expire_time < ?
       )`, playerUuid, Date.now())
}

/** 未读数只统计客户端真正能看到的邮件：排除悬空引用与编辑中隐藏的邮件。 */
export function countGameMailUnread(playerUuid: string): number {
  const row = get(`SELECT COUNT(*) AS total FROM game_mail_refs r
                   JOIN game_mails m ON m.id = r.mail_id
                   WHERE r.player_uuid = ? AND r.read = 0 AND m.hidden = 0`, playerUuid)
  return Number(row?.total ?? 0)
}

/**
 * 批量取某封邮件在指定玩家处的引用。编辑 / 取消编辑之后要给每个在线收件人
 * 推送带自身读、星标、领取状态的条目，逐人查询会打出几十次请求。
 */
export function listGameMailRefsFor(
  mailId: string,
  playerUuids: string[],
): Record<string, GameMailRef> {
  const refs: Record<string, GameMailRef> = {}
  if (playerUuids.length === 0) return refs
  const placeholders = playerUuids.map(() => '?').join(', ')
  const rows = all(`SELECT * FROM game_mail_refs
                    WHERE mail_id = ? AND player_uuid IN (${placeholders})`, mailId, ...playerUuids)
  for (const row of rows) refs[String(row.player_uuid)] = mapGameMailRef(row)
  return refs
}

/**
 * 批量未读数。群发 / 撤回 / 清理之后模组要给所有在线收件人刷新徽标，
 * 逐人查询会打出几十次请求，这里一次算完；未出现在结果里的玩家按 0 处理。
 */
export function countGameMailUnreadBatch(playerUuids: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const playerUuid of playerUuids) counts[playerUuid] = 0
  if (playerUuids.length === 0) return counts
  const placeholders = playerUuids.map(() => '?').join(', ')
  const rows = all(`SELECT r.player_uuid AS player_uuid, COUNT(*) AS total
                    FROM game_mail_refs r
                    JOIN game_mails m ON m.id = r.mail_id
                    WHERE r.read = 0 AND m.hidden = 0 AND r.player_uuid IN (${placeholders})
                    GROUP BY r.player_uuid`, ...playerUuids)
  for (const row of rows) counts[String(row.player_uuid)] = Number(row.total ?? 0)
  return counts
}

export function listGameMailInbox(
  playerUuid: string,
  keepStarred: boolean,
): { ref: GameMailRef; mail: GameMail }[] {
  cleanupGameMailbox(playerUuid, keepStarred)
  // 引用列必须换名：game_mails 也有 claimed 列，同名会在结果行里互相覆盖。
  return all(`SELECT r.mail_id AS ref_mail_id, r.read AS ref_read,
                     r.starred AS ref_starred, r.claimed AS ref_claimed, m.*
              FROM game_mail_refs r
              JOIN game_mails m ON m.id = r.mail_id
              WHERE r.player_uuid = ? AND m.hidden = 0
              ORDER BY m.created_time DESC, m.id`, playerUuid)
    .map((row) => ({
      ref: mapGameMailRef({
        mail_id: row.ref_mail_id,
        read: row.ref_read,
        starred: row.ref_starred,
        claimed: row.ref_claimed,
      }),
      mail: mapGameMail(row),
    }))
}

function writeGameMailRow(id: string, input: GameMailInput, createdTime: number,
  claimed: boolean, hidden: boolean): void {
  run(`INSERT INTO game_mails
       (id, type, sender, targets, scope_summary, title, body, created_time, expire_time,
        claimed, hidden, attachments, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type, sender = excluded.sender, targets = excluded.targets,
         scope_summary = excluded.scope_summary, title = excluded.title, body = excluded.body,
         expire_time = excluded.expire_time, claimed = excluded.claimed, hidden = excluded.hidden,
         attachments = excluded.attachments, updated_at = excluded.updated_at`,
    id, input.type, input.sender, JSON.stringify(input.targets), input.scopeSummary,
    input.title, input.body, createdTime, input.expireTime,
    claimed ? 1 : 0, hidden ? 1 : 0, JSON.stringify(input.attachments), Date.now())
}

function insertGameMailRefs(mailId: string, recipients: string[]): void {
  const now = Date.now()
  for (const playerUuid of recipients) {
    run(`INSERT INTO game_mail_refs (mail_id, player_uuid, read, starred, claimed, created_at)
         VALUES (?, ?, 0, 0, 0, ?)
         ON CONFLICT(mail_id, player_uuid) DO NOTHING`, mailId, playerUuid, now)
  }
}

export function insertGameMail(
  input: GameMailInput,
  recipients: string[],
): { mail: GameMail; recipients: string[] } {
  const id = randomUUID()
  const createdTime = Date.now()
  db.exec('BEGIN IMMEDIATE')
  try {
    writeGameMailRow(id, input, createdTime, false, false)
    insertGameMailRefs(id, recipients)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  const mail = getGameMail(id)
  if (!mail) throw createError({ statusCode: 500, message: '邮件写入失败' })
  return { mail, recipients: listGameMailRecipients(id) }
}

/**
 * 编辑邮件并对接收范围做 diff：新增收件人建引用，被移出且未领取的删引用，
 * 已领取的引用一律保留（与旧 {@code MailManager.edit} 一致）。
 */
export function updateGameMail(
  id: string,
  input: GameMailInput,
  recipients: string[],
  hidden: boolean | undefined,
): { mail: GameMail; recipients: string[]; removed: string[] } {
  const removed: string[] = []
  db.exec('BEGIN IMMEDIATE')
  try {
    const current = getGameMail(id)
    if (!current) throw createError({ statusCode: 404, message: '邮件不存在或已撤回' })
    const editState = computeGameMailEditState(current)
    if (!editState.canEdit) {
      throw createError({ statusCode: 409, message: editState.denyReason || '邮件不可编辑' })
    }
    const keep = new Set(recipients)
    for (const row of all('SELECT player_uuid, claimed FROM game_mail_refs WHERE mail_id = ?', id)) {
      const playerUuid = String(row.player_uuid)
      if (keep.has(playerUuid) || Number(row.claimed ?? 0) === 1) continue
      run('DELETE FROM game_mail_refs WHERE mail_id = ? AND player_uuid = ?', id, playerUuid)
      removed.push(playerUuid)
    }
    writeGameMailRow(id, input, current.createdTime, current.claimed,
      hidden === undefined ? current.hidden : hidden)
    insertGameMailRefs(id, recipients)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  const mail = getGameMail(id)
  if (!mail) throw createError({ statusCode: 500, message: '邮件写入失败' })
  return { mail, recipients: listGameMailRecipients(id), removed }
}

/** 编辑期间隐藏 / 恢复邮件；隐藏的邮件不出现在任何收件箱里。 */
export function setGameMailHidden(
  id: string,
  hidden: boolean,
): { mail: GameMail; recipients: string[] } {
  const result = run('UPDATE game_mails SET hidden = ?, updated_at = ? WHERE id = ?',
    hidden ? 1 : 0, Date.now(), id)
  if (Number(result.changes ?? 0) === 0) {
    throw createError({ statusCode: 404, message: '邮件不存在或已撤回' })
  }
  const mail = getGameMail(id)
  if (!mail) throw createError({ statusCode: 404, message: '邮件不存在或已撤回' })
  return { mail, recipients: listGameMailRecipients(id) }
}

/** 撤回邮件：删正文与全部引用，返回原收件人便于模组推送移除。 */
export function deleteGameMail(id: string): { removed: boolean; recipients: string[] } {
  db.exec('BEGIN IMMEDIATE')
  try {
    const recipients = listGameMailRecipients(id)
    const result = run('DELETE FROM game_mails WHERE id = ?', id)
    run('DELETE FROM game_mail_refs WHERE mail_id = ?', id)
    db.exec('COMMIT')
    return { removed: Number(result.changes ?? 0) > 0, recipients }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** 已读 / 星标 / 取消星标 / 删除；删除后 ref 为 null。 */
export function applyGameMailAction(
  playerUuid: string,
  mailId: string,
  action: MailAction,
): { ref: GameMailRef | null; unread: number } {
  const existing = getGameMailRef(mailId, playerUuid)
  if (!existing) throw createError({ statusCode: 404, message: '收件箱中没有这封邮件' })
  switch (action) {
    case 'read':
      run('UPDATE game_mail_refs SET read = 1 WHERE mail_id = ? AND player_uuid = ?', mailId, playerUuid)
      break
    case 'star':
      run('UPDATE game_mail_refs SET starred = 1 WHERE mail_id = ? AND player_uuid = ?', mailId, playerUuid)
      break
    case 'unstar':
      run('UPDATE game_mail_refs SET starred = 0 WHERE mail_id = ? AND player_uuid = ?', mailId, playerUuid)
      break
    case 'delete':
      run('DELETE FROM game_mail_refs WHERE mail_id = ? AND player_uuid = ?', mailId, playerUuid)
      break
  }
  return {
    ref: action === 'delete' ? null : getGameMailRef(mailId, playerUuid) ?? null,
    unread: countGameMailUnread(playerUuid),
  }
}

/**
 * 原子领取奖励：校验通过后立即写入 claimed，再把附件交给模组发放。
 * 先标记后发放是刻意的 —— 宁可在极端崩溃下丢一次奖励，也不能让同一封邮件被领两次。
 */
export function claimGameMail(
  playerUuid: string,
  mailId: string,
): { mail: GameMail; ref: GameMailRef; unread: number } {
  db.exec('BEGIN IMMEDIATE')
  try {
    const mail = getGameMail(mailId)
    if (!mail) throw createError({ statusCode: 404, message: '邮件不存在或已撤回' })
    if (mail.type !== 'REWARD') throw createError({ statusCode: 409, message: '该邮件没有可领取的奖励' })
    if (gameMailIsExpired(mail)) throw createError({ statusCode: 410, message: '邮件已过期' })
    const ref = getGameMailRef(mailId, playerUuid)
    if (!ref) throw createError({ statusCode: 404, message: '收件箱中没有这封邮件' })
    if (ref.claimed) throw createError({ statusCode: 409, message: '奖励已经领取过了' })
    // 领取即视为已读，避免领完奖励红点仍在。
    run(`UPDATE game_mail_refs SET claimed = 1, read = 1
         WHERE mail_id = ? AND player_uuid = ? AND claimed = 0`, mailId, playerUuid)
    run('UPDATE game_mails SET claimed = 1, updated_at = ? WHERE id = ?', Date.now(), mailId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  const mail = getGameMail(mailId)
  const ref = getGameMailRef(mailId, playerUuid)
  if (!mail || !ref) throw createError({ statusCode: 500, message: '领取状态写入失败' })
  return { mail, ref, unread: countGameMailUnread(playerUuid) }
}

/**
 * 清理过期邮件。keepStarred 为真时，只要还有任意玩家星标过就保留，
 * 与界面提示「已收藏的过期邮件将保留」一致。顺带剔除全部悬空引用。
 */
export function purgeGameMails(keepStarred: boolean): {
  removed: number
  removedIds: string[]
  affected: string[]
  prunedRefs: number
} {
  db.exec('BEGIN IMMEDIATE')
  try {
    const now = Date.now()
    const expired = all(`SELECT id FROM game_mails
                         WHERE expire_time IS NOT NULL AND expire_time < ?`, now)
      .map((row) => String(row.id))
    const starred = new Set(keepStarred
      ? all('SELECT DISTINCT mail_id FROM game_mail_refs WHERE starred = 1').map((row) => String(row.mail_id))
      : [])
    const removedIds = expired.filter((id) => !starred.has(id))
    const affected = new Set<string>()
    for (const id of removedIds) {
      for (const playerUuid of listGameMailRecipients(id)) affected.add(playerUuid)
      run('DELETE FROM game_mails WHERE id = ?', id)
      run('DELETE FROM game_mail_refs WHERE mail_id = ?', id)
    }
    const prunedRefs = pruneDanglingGameMailRefs()
    db.exec('COMMIT')
    return { removed: removedIds.length, removedIds, affected: [...affected], prunedRefs }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** 账户注销时清空其收件箱（正文仓库不动，其他收件人仍能看到）。 */
export function deleteGameMailbox(playerUuid: string): number {
  const result = run('DELETE FROM game_mail_refs WHERE player_uuid = ?', playerUuid)
  return Number(result.changes ?? 0)
}

// ===== 后台只读查询 =====
// 供管理页面查看游戏内已发布的邮件。发布 / 编辑仍然只在游戏内进行：
// 物品附件的 NBT 只能从管理员物品栏序列化，网页无法构造。

export interface AdminGameMailSummary {
  id: string
  type: MailType
  sender: string
  title: string
  scopeSummary: string
  createdTime: number
  expireTime: number | null
  expired: boolean
  claimed: boolean
  hidden: boolean
  attachmentCount: number
  recipientCount: number
  readCount: number
  starredCount: number
  claimedCount: number
}

export interface AdminGameMailRecipient {
  uuid: string
  /** 账户表里匹配得到的玩家代号；匹配不到时为 null，由前端回退显示 UUID。 */
  username: string | null
  read: boolean
  starred: boolean
  claimed: boolean
}

export interface AdminGameMailDetail extends AdminGameMailSummary {
  body: string
  targets: MailTargetSpec[]
  attachments: MailAttachment[]
  recipients: AdminGameMailRecipient[]
}

function adminGameMailSummary(row: Record<string, unknown>, now: number): AdminGameMailSummary {
  const mail = mapGameMail(row)
  return {
    id: mail.id,
    type: mail.type,
    sender: mail.sender,
    title: mail.title,
    scopeSummary: mail.scopeSummary,
    createdTime: mail.createdTime,
    expireTime: mail.expireTime,
    expired: gameMailIsExpired(mail, now),
    claimed: mail.claimed,
    hidden: mail.hidden,
    attachmentCount: mail.attachments.length,
    recipientCount: Number(row.recipient_count ?? 0),
    readCount: Number(row.read_count ?? 0),
    starredCount: Number(row.starred_count ?? 0),
    claimedCount: Number(row.claimed_count ?? 0),
  }
}

// 聚合列另起别名：game_mails 自己也有 claimed 列，同名会在结果行里互相覆盖。
const ADMIN_MAIL_STATS_SQL = `
  SELECT m.*,
         COUNT(r.player_uuid) AS recipient_count,
         COALESCE(SUM(r.read), 0) AS read_count,
         COALESCE(SUM(r.starred), 0) AS starred_count,
         COALESCE(SUM(r.claimed), 0) AS claimed_count
  FROM game_mails m
  LEFT JOIN game_mail_refs r ON r.mail_id = m.id
`

export function listAdminGameMails(): AdminGameMailSummary[] {
  const now = Date.now()
  return all(`${ADMIN_MAIL_STATS_SQL} GROUP BY m.id ORDER BY m.created_time DESC, m.id`)
    .map((row) => adminGameMailSummary(row, now))
}

export function getAdminGameMailDetail(id: string): AdminGameMailDetail | undefined {
  const row = get(`${ADMIN_MAIL_STATS_SQL} WHERE m.id = ? GROUP BY m.id`, id)
  if (!row) return undefined
  const mail = mapGameMail(row)
  // uuid 列历史上可能存过大写，这里按小写比对；收件人列表是单封邮件的量级，不走索引也可接受。
  const recipients = all(`SELECT r.player_uuid AS player_uuid, r.read AS ref_read,
                                 r.starred AS ref_starred, r.claimed AS ref_claimed,
                                 a.username AS username
                          FROM game_mail_refs r
                          LEFT JOIN game_accounts a ON lower(a.uuid) = r.player_uuid
                          WHERE r.mail_id = ?
                          ORDER BY a.username COLLATE NOCASE, r.player_uuid`, id)
    .map((item) => ({
      uuid: String(item.player_uuid),
      username: item.username == null ? null : String(item.username),
      read: Number(item.ref_read ?? 0) === 1,
      starred: Number(item.ref_starred ?? 0) === 1,
      claimed: Number(item.ref_claimed ?? 0) === 1,
    }))
  return {
    ...adminGameMailSummary(row, Date.now()),
    body: mail.body,
    targets: mail.targets,
    attachments: mail.attachments,
    recipients,
  }
}

function count(table: string): number {
  return (get(`SELECT COUNT(*) AS c FROM ${table}`)?.c as number) ?? 0
}

async function readJsonFile<T>(file: string): Promise<T | null> {
  const filePath = path.join(dataDir, file)
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function migrateFromJson() {
  const config = await readJsonFile<{ password?: string; entry?: string }>('config.json')
  const legacyPassword = getSetting('password') || config?.password || ''
  const configuredPassword = process.env[ADMIN_PASSWORD_ENV]?.trim() || ''
  if (getSetting(ADMIN_PASSWORD_SETTING) === undefined) {
    const initialPassword = configuredPassword || legacyPassword
    if (initialPassword.length >= 12 && initialPassword.length <= 128) {
      setSetting(ADMIN_PASSWORD_SETTING, hashAdminPassword(initialPassword))
    }
  }
  deleteSetting('password')
  // 升级时删除旧版本遗留的无效账户设置键。
  deleteSetting('game_account.' + 'session_' + 'timeout')

  const storedEntry = getSetting(ADMIN_ENTRY_SETTING)?.trim() || ''
  if (!ADMIN_ENTRY_RE.test(storedEntry) || RESERVED_ADMIN_ENTRIES.has(storedEntry.toLowerCase())) {
    const entry = (process.env[ADMIN_ENTRY_ENV]?.trim() || config?.entry || '')
      .replace(/^\/+|\/+$/g, '')
    if (ADMIN_ENTRY_RE.test(entry) && !RESERVED_ADMIN_ENTRIES.has(entry.toLowerCase())) {
      setAdminEntry(entry)
    }
  }

  if (count('admin_users') === 0) {
    const passwordHash = getSetting(ADMIN_PASSWORD_SETTING) || ''
    const configuredUsername = process.env[ADMIN_USERNAME_ENV]?.trim() || 'admin'
    const configuredEntry = getSetting(ADMIN_ENTRY_SETTING)?.trim() || ''
    if (passwordHash.startsWith('PBKDF2:') && ADMIN_USER_RE.test(configuredUsername)
        && ADMIN_ENTRY_RE.test(configuredEntry) && !RESERVED_ADMIN_ENTRIES.has(configuredEntry.toLowerCase())) {
      const now = Date.now()
      run(
        'INSERT INTO admin_users (username, password_hash, avatar, is_owner, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, 1, ?, ?)',
        configuredUsername, passwordHash, DEFAULT_ADMIN_AVATAR, now, now,
      )
      // 多用户认证已迁移到 admin_users，删除旧设置中的历史哈希，避免保留第二个认证源。
      deleteSetting(ADMIN_PASSWORD_SETTING)
    }
  }
  if (getSetting('security.owner_avatar_initialized') !== 'true') {
    run("UPDATE admin_users SET avatar = ? WHERE is_owner = 1 AND (avatar IS NULL OR avatar = '')", DEFAULT_ADMIN_AVATAR)
    setSetting('security.owner_avatar_initialized', 'true')
  }
  // admin_users 是唯一认证源；完成迁移后清除可能残留的旧哈希键。
  if (count('admin_users') > 0) deleteSetting(ADMIN_PASSWORD_SETTING)

  if (getSetting('security.admin_multi_user') !== 'true') {
    run('DELETE FROM sessions')
    setSetting('security.admin_multi_user', 'true')
  }

  // 旧后台会话保存的是明文令牌；升级后统一失效并改为仅存 SHA-256 摘要。
  if (getSetting('security.sessions_hashed') !== 'true') {
    run('DELETE FROM sessions')
    setSetting('security.sessions_hashed', 'true')
  }

  // 旧游戏会话保存的是明文令牌；升级后统一失效，避免摘要迁移期间保留可直接使用的凭据。
  if (getSetting('security.game_sessions_hashed') !== 'true') {
    run('DELETE FROM game_sessions')
    setSetting('security.game_sessions_hashed', 'true')
  }

  if (count('login_history') === 0) {
    const history = await readJsonFile<{ ip: string; time: number }[]>('login-history.json')
    if (history) {
      for (const item of history) {
        run('INSERT INTO login_history (ip, time) VALUES (?, ?)', item.ip, item.time)
      }
    }
  }

  if (count('activities') === 0) {
    const items = await readJsonFile<Activity[]>('activities.json')
    if (items) {
      for (const item of items) insertActivity(item)
    }
  }

  if (count('donors') === 0) {
    const items = await readJsonFile<Donor[]>('donors.json')
    if (items) {
      for (const item of items) insertDonor(item)
    }
  }

  if (count('bans') === 0) {
    const items = await readJsonFile<Ban[]>('bans.json')
    if (items) {
      for (const item of items) insertBan(item)
    }
  }

  if (count('updates') === 0) {
    const items = await readJsonFile<UpdateEntry[]>('updates.json')
    if (items) {
      for (const item of items) insertUpdate(item)
    }
  }

  for (const file of ['config.json', 'sessions.json', 'login-history.json', 'activities.json', 'donors.json', 'bans.json', 'updates.json']) {
    await fs.rm(path.join(dataDir, file), { force: true }).catch(() => {})
  }
}
