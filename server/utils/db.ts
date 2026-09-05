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
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getCookie, getHeader, createError, type H3Event } from 'h3'
import { dataDir, ensureDataDirs } from './data-dir'
import { offlinePlayerUuid, requireEmailAddress, requireGameUsername, requirePlayerUuid } from './game-input'
import type { MailAction, MailAttachment, MailTargetSpec, MailType } from './game-input'
import type { InboundMailPayload } from './inbound-mail'
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
  ADMIN_FEATURE_DEFINITIONS,
  ADMIN_NAVIGATION_ORDER,
  ADMIN_PAGE_DEFINITIONS,
  defaultAdminFeaturePermissions,
  defaultAdminPagePermissions,
  normalizeAdminNavigationPreferences,
  ownerAdminFeaturePermissions,
  ownerAdminPagePermissions,
  permissionAllows,
  type AdminFeaturePermissionLevel,
  type AdminNavigationPreferences,
  type AdminPagePermissionLevel,
} from '#shared/admin-page-permissions'
import {
  calculatePasswordExpiryStatus,
  DEFAULT_PASSWORD_EXPIRY_POLICY,
  DEFAULT_PASSWORD_POLICY,
  MAX_PASSWORD_EXPIRY_DAYS,
  MIN_PASSWORD_EXPIRY_DAYS,
  normalizePasswordExpiryDays,
  normalizePasswordPolicyMinimumScore,
  passwordMeetsPolicy,
  passwordPolicyRequirementLabels,
  passwordStrengthLabel,
  type PasswordPolicy,
  type PasswordPolicyMinimumScore,
  type PasswordExpiryPolicy,
  type PasswordExpiryStatus,
} from '#shared/password-policy'
import { WEB_ASSET_BASE_URL } from '#shared/web-assets'

ensureDataDirs()

const db = new DatabaseSync(path.join(dataDir, 'database.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS status_history (
    captured_at INTEGER PRIMARY KEY,
    overall TEXT NOT NULL,
    node_status TEXT NOT NULL,
    minecraft_status TEXT NOT NULL,
    snapshot_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS status_history_captured_idx
    ON status_history (captured_at DESC);
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    time INTEGER NOT NULL,
    user_id INTEGER,
    last_seen INTEGER NOT NULL DEFAULT 0,
    ip TEXT NOT NULL DEFAULT '',
    browser TEXT NOT NULL DEFAULT '',
    os TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '',
    full_name TEXT NOT NULL DEFAULT '',
    navigation_preferences TEXT NOT NULL DEFAULT '',
    password_changed_at INTEGER NOT NULL DEFAULT 0,
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
  CREATE TABLE IF NOT EXISTS admin_feature_permissions (
    user_id INTEGER NOT NULL,
    feature_key TEXT NOT NULL,
    level TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, feature_key)
  );
  CREATE TABLE IF NOT EXISTS admin_password_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    password_hash TEXT NOT NULL,
    changed_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS admin_password_history_user_idx
    ON admin_password_history (user_id, changed_at DESC, id DESC);
  CREATE TABLE IF NOT EXISTS admin_presence (
    user_id INTEGER PRIMARY KEY,
    path TEXT NOT NULL DEFAULT '/',
    last_seen INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS admin_presence_seen_idx ON admin_presence (last_seen DESC);
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
    user_id INTEGER,
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
  CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
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
  CREATE TABLE IF NOT EXISTS game_player_stats (
    player_uuid TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    last_updated INTEGER NOT NULL DEFAULT 0,
    stats_json TEXT NOT NULL DEFAULT '{}',
    stats_updated_json TEXT NOT NULL DEFAULT '{}',
    stats_source_json TEXT NOT NULL DEFAULT '{}',
    last_reset_id TEXT NOT NULL DEFAULT '',
    uploaded_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS game_player_stats_uploaded_idx
    ON game_player_stats (uploaded_at DESC);
  CREATE TABLE IF NOT EXISTS game_titles (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    render_type TEXT NOT NULL,
    text_content TEXT NOT NULL DEFAULT '',
    text_color TEXT NOT NULL DEFAULT '#FFFFFF',
    bold INTEGER NOT NULL DEFAULT 0,
    italic INTEGER NOT NULL DEFAULT 0,
    texture_key TEXT NOT NULL DEFAULT '',
    font_id TEXT NOT NULL DEFAULT 'youzaiworldcore:title',
    glyph TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    system_managed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_player_title_grants (
    username_lower TEXT NOT NULL,
    title_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_key TEXT NOT NULL DEFAULT '',
    granted_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (username_lower, title_id, source, source_key)
  );
  CREATE INDEX IF NOT EXISTS game_player_title_grants_player_idx
    ON game_player_title_grants (username_lower, title_id);
  CREATE TABLE IF NOT EXISTS game_player_title_selection (
    username_lower TEXT PRIMARY KEY,
    title_id TEXT NOT NULL,
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
  CREATE TABLE IF NOT EXISTS admin_login_takeovers (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    ip TEXT NOT NULL,
    browser TEXT NOT NULL,
    os TEXT NOT NULL,
    device TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS admin_login_takeovers_expires_idx
    ON admin_login_takeovers (expires_at);
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
  CREATE TABLE IF NOT EXISTS domain_mails (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL DEFAULT '',
    envelope_from TEXT NOT NULL DEFAULT '',
    envelope_to TEXT NOT NULL DEFAULT '',
    mailbox TEXT NOT NULL DEFAULT '',
    from_address TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT '',
    to_addresses TEXT NOT NULL DEFAULT '[]',
    cc_addresses TEXT NOT NULL DEFAULT '[]',
    reply_to TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    sent_time INTEGER,
    received_time INTEGER NOT NULL,
    text_body TEXT NOT NULL DEFAULT '',
    html_body TEXT NOT NULL DEFAULT '',
    raw_size INTEGER NOT NULL DEFAULT 0,
    spf TEXT NOT NULL DEFAULT '',
    dkim TEXT NOT NULL DEFAULT '',
    dmarc TEXT NOT NULL DEFAULT '',
    truncated INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS domain_mails_received_idx ON domain_mails (received_time DESC, id);
  CREATE INDEX IF NOT EXISTS domain_mails_mailbox_idx ON domain_mails (mailbox);
  CREATE UNIQUE INDEX IF NOT EXISTS domain_mails_message_id_idx
    ON domain_mails (message_id) WHERE message_id <> '';
  CREATE TABLE IF NOT EXISTS domain_mail_attachments (
    id TEXT PRIMARY KEY,
    mail_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    filename TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    disposition TEXT NOT NULL DEFAULT '',
    content_id TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL DEFAULT '',
    content BLOB,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS domain_mail_attachments_mail_idx
    ON domain_mail_attachments (mail_id, position);
  CREATE TABLE IF NOT EXISTS domain_mail_reads (
    user_id INTEGER NOT NULL,
    mail_id TEXT NOT NULL,
    read_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, mail_id)
  );
  CREATE INDEX IF NOT EXISTS domain_mail_reads_mail_idx
    ON domain_mail_reads (mail_id, user_id);
  CREATE TABLE IF NOT EXISTS domain_mail_prefix_permissions (
    user_id INTEGER NOT NULL,
    prefix TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, prefix)
  );
  CREATE INDEX IF NOT EXISTS domain_mail_prefix_permissions_user_idx
    ON domain_mail_prefix_permissions (user_id, prefix);
  CREATE TABLE IF NOT EXISTS domain_mail_access_settings (
    user_id INTEGER PRIMARY KEY,
    all_mailboxes INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS domain_mail_sent (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    sender_address TEXT NOT NULL DEFAULT '',
    sender_name TEXT NOT NULL DEFAULT '',
    recipient TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    text_body TEXT NOT NULL DEFAULT '',
    html_body TEXT NOT NULL DEFAULT '',
    attachments_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS domain_mail_sent_user_idx
    ON domain_mail_sent (user_id, created_at DESC, id);
  CREATE INDEX IF NOT EXISTS domain_mail_sent_created_idx
    ON domain_mail_sent (created_at DESC, id);
`)

const gamePlayerStatsColumns = db.prepare('PRAGMA table_info(game_player_stats)').all() as { name?: string }[]
if (!gamePlayerStatsColumns.some((column) => column.name === 'stats_updated_json')) {
  try {
    db.exec("ALTER TABLE game_player_stats ADD COLUMN stats_updated_json TEXT NOT NULL DEFAULT '{}'")
  } catch (error) {
    const migratedColumns = db.prepare('PRAGMA table_info(game_player_stats)').all() as { name?: string }[]
    if (!migratedColumns.some((column) => column.name === 'stats_updated_json')) throw error
  }
}
for (const [column, definition] of [
  ['stats_source_json', "TEXT NOT NULL DEFAULT '{}'"],
  ['last_reset_id', "TEXT NOT NULL DEFAULT ''"],
] as const) {
  if (gamePlayerStatsColumns.some((item) => item.name === column)) continue
  try {
    db.exec(`ALTER TABLE game_player_stats ADD COLUMN ${column} ${definition}`)
  } catch (error) {
    const migratedColumns = db.prepare('PRAGMA table_info(game_player_stats)').all() as { name?: string }[]
    if (!migratedColumns.some((item) => item.name === column)) throw error
  }
}

const defaultGameTitles = [
  ['newbie_plea', '萌新求饶', 'texture', '萌新求饶', '#55FF55', 'new', '\uE100', 10, 1],
  ['admin_junior', '初级管理员', 'texture', '初级管理员', '#55FFFF', 'junior_administrator', '\uE101', 20, 1],
  ['admin_middle', '中级管理员', 'texture', '中级管理员', '#FFAA00', 'middle_administrator', '\uE102', 30, 1],
  ['admin_senior', '高级管理员', 'texture', '高级管理员', '#FF5555', 'senior_administrator', '\uE103', 40, 1],
] as const
const seedGameTitle = db.prepare(`INSERT OR IGNORE INTO game_titles
  (id, display_name, render_type, text_content, text_color, texture_key, font_id, glyph,
   enabled, sort_order, system_managed, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 'youzaiworldcore:title', ?, 1, ?, ?, ?, ?)`)
for (const [id, displayName, renderType, textContent, textColor, textureKey, glyph, sortOrder, systemManaged] of defaultGameTitles) {
  const now = Date.now()
  seedGameTitle.run(id, displayName, renderType, textContent, textColor, textureKey, glyph, sortOrder, systemManaged, now, now)
}

// 默认称号只在账户第一次完成注册时发放。触发器与账户写入处于同一 SQLite 事务，
// 不会回填已有账户，也不会在管理员回收后因普通账户更新而重新补发。
db.exec(`
  CREATE TRIGGER IF NOT EXISTS game_accounts_default_title_after_insert
  AFTER INSERT ON game_accounts
  WHEN NEW.password <> ''
  BEGIN
    INSERT OR IGNORE INTO game_player_title_grants
      (username_lower, title_id, source, source_key, granted_by, created_at)
      VALUES (NEW.username_lower, 'newbie_plea', 'registration', 'new_account', 'system', unixepoch('subsec') * 1000);
    INSERT OR IGNORE INTO game_player_title_selection
      (username_lower, title_id, updated_at)
      VALUES (NEW.username_lower, 'newbie_plea', unixepoch('subsec') * 1000);
  END;

  CREATE TRIGGER IF NOT EXISTS game_accounts_default_title_after_registration
  AFTER UPDATE OF password ON game_accounts
  WHEN OLD.password = '' AND NEW.password <> ''
  BEGIN
    INSERT OR IGNORE INTO game_player_title_grants
      (username_lower, title_id, source, source_key, granted_by, created_at)
      VALUES (NEW.username_lower, 'newbie_plea', 'registration', 'new_account', 'system', unixepoch('subsec') * 1000);
    INSERT OR IGNORE INTO game_player_title_selection
      (username_lower, title_id, updated_at)
      VALUES (NEW.username_lower, 'newbie_plea', unixepoch('subsec') * 1000);
  END;
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
if (!adminUserColumns.some((column) => column.name === 'navigation_preferences')) {
  try {
    db.exec("ALTER TABLE admin_users ADD COLUMN navigation_preferences TEXT NOT NULL DEFAULT ''")
  } catch (error) {
    const migratedColumns = db.prepare('PRAGMA table_info(admin_users)').all() as { name?: string }[]
    if (!migratedColumns.some((column) => column.name === 'navigation_preferences')) throw error
  }
}
if (!adminUserColumns.some((column) => column.name === 'password_changed_at')) {
  try {
    db.exec('ALTER TABLE admin_users ADD COLUMN password_changed_at INTEGER NOT NULL DEFAULT 0')
  } catch (error) {
    const migratedColumns = db.prepare('PRAGMA table_info(admin_users)').all() as { name?: string }[]
    if (!migratedColumns.some((column) => column.name === 'password_changed_at')) throw error
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
for (const [column, definition] of [
  ['last_seen', 'INTEGER NOT NULL DEFAULT 0'],
  ['ip', "TEXT NOT NULL DEFAULT ''"],
  ['browser', "TEXT NOT NULL DEFAULT ''"],
  ['os', "TEXT NOT NULL DEFAULT ''"],
  ['device', "TEXT NOT NULL DEFAULT ''"],
] as const) {
  if (sessionColumns.some((item) => item.name === column)) continue
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN ${column} ${definition}`)
  } catch (error) {
    const migratedColumns = db.prepare('PRAGMA table_info(sessions)').all() as { name?: string }[]
    if (!migratedColumns.some((item) => item.name === column)) throw error
  }
}
db.exec('UPDATE sessions SET last_seen = time WHERE last_seen <= 0')
// 单设备登录上线时，历史数据库可能已有多个会话；仅保留每个账户最近活动的一个。
db.exec(`
  DELETE FROM sessions
  WHERE user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM sessions AS newer
      WHERE newer.user_id = sessions.user_id
        AND (
          newer.last_seen > sessions.last_seen
          OR (newer.last_seen = sessions.last_seen AND newer.time > sessions.time)
          OR (newer.last_seen = sessions.last_seen AND newer.time = sessions.time AND newer.token > sessions.token)
        )
    )
`)

const loginHistoryColumns = db.prepare('PRAGMA table_info(login_history)').all() as { name?: string }[]
for (const [column, definition] of [
  ['user_id', 'INTEGER'],
  ['username', "TEXT NOT NULL DEFAULT ''"],
  ['browser', "TEXT NOT NULL DEFAULT ''"],
  ['os', "TEXT NOT NULL DEFAULT ''"],
  ['device', "TEXT NOT NULL DEFAULT ''"],
] as const) {
  if (loginHistoryColumns.some((item) => item.name === column)) continue
  try {
    db.exec(`ALTER TABLE login_history ADD COLUMN ${column} ${definition}`)
  } catch (error) {
    // 多进程同时启动时，允许另一进程已经先完成同一迁移。
    const migratedColumns = db.prepare('PRAGMA table_info(login_history)').all() as { name?: string }[]
    if (!migratedColumns.some((item) => item.name === column)) throw error
  }
}
db.exec(`
  CREATE INDEX IF NOT EXISTS sessions_user_seen_idx ON sessions (user_id, last_seen DESC);
  CREATE INDEX IF NOT EXISTS login_history_user_time_idx ON login_history (user_id, time DESC);
  CREATE INDEX IF NOT EXISTS audit_logs_user_time_idx ON audit_logs (user_id, time DESC);
`)

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
const ADMIN_ONLINE_WINDOW_MS = 5 * 60 * 1000
const ADMIN_LOGIN_TAKEOVER_TTL_MS = 2 * 60 * 1000
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
const PASSWORD_POLICY_ENABLED_SETTING = 'password_policy.enabled'
const PASSWORD_POLICY_MINIMUM_SCORE_SETTING = 'password_policy.minimum_score'
const PASSWORD_EXPIRY_ENABLED_SETTING = 'password_expiry.enabled'
const PASSWORD_EXPIRY_DAYS_SETTING = 'password_expiry.days'
const STATUS_HISTORY_CLEARED_AT_SETTING = 'status_history.cleared_at'
const RESERVED_ADMIN_ENTRIES = new Set([
  'login', 'account', 'activity', 'donors', 'bans', 'updates', 'game-accounts',
  'game-cosmetics', 'game-stats', 'game-account-email-templates', 'server-manage', 'server-files',
  'admin-users', 'audit-logs', 'chat', 'mail', 'domain-mail', 'settings', 'permissions', 'api', '_nuxt', '_ipx', 'favicon', '__nuxt_error',
])

// ===== 域名邮件（Cloudflare Email Worker 投递的 @mcyzw.top 收件） =====
// Worker 用独立密钥签名，与游戏 Api 密钥分开：Worker 被攻破也只能写入收件，
// 碰不到游戏账户接口。
const INBOUND_MAIL_KEY_ENV = 'YZWC_INBOUND_MAIL_KEY'
const INBOUND_MAIL_KEY_SETTING = 'inbound_mail.key'
// 收件保留上限：邮件带附件二进制，无上限会把磁盘吃满。超出后按接收时间淘汰最旧的。
const DOMAIN_MAIL_RETENTION_ROWS = 2000
const DOMAIN_MAIL_SENT_RETENTION_ROWS = 2000

// ===== MCSManager 面板（「服务器管理」页） =====
// ApiKey 等价于面板账户的全部权限（发命令、改文件、停服），因此写进 settings 后
// 一律不再回显：接口只回报「是否已配置」，留空提交表示沿用旧值。
// 与 turnstile.secret / inbound_mail.key 同一套存法，全部外呼只在服务端发起。
const MCSM_BASE_URL_SETTING = 'mcsm.base_url'
const MCSM_API_KEY_SETTING = 'mcsm.api_key'
const MCSM_BASE_URL_ENV = 'YZWC_MCSM_BASE_URL'
const MCSM_API_KEY_ENV = 'YZWC_MCSM_API_KEY'

export const ADMIN_COOKIE_NAME = '__Host-yzwc_admin'
const ADMIN_USER_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/
const DEFAULT_ADMIN_AVATAR = `${WEB_ASSET_BASE_URL}/favicon.ico`

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

export interface StatusHistorySampleInput {
  capturedAt: number
  overall: string
  nodeStatus: string
  minecraftStatus: string
  snapshot: unknown
}

export interface StatusHistoryStats {
  count: number
  oldestAt: number | null
  latestAt: number | null
}

export function saveStatusHistorySamples(samples: StatusHistorySampleInput[]): number {
  let saved = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    const clearedAt = Number(getSetting(STATUS_HISTORY_CLEARED_AT_SETTING) || 0)
    const statement = db.prepare(`
      INSERT INTO status_history (captured_at, overall, node_status, minecraft_status, snapshot_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(captured_at) DO UPDATE SET
        overall = excluded.overall,
        node_status = excluded.node_status,
        minecraft_status = excluded.minecraft_status,
        snapshot_json = excluded.snapshot_json
    `)
    for (const sample of samples) {
      const capturedAt = Number(sample.capturedAt)
      if (!Number.isFinite(capturedAt) || capturedAt <= 0 || capturedAt <= clearedAt) continue
      statement.run(
        Math.trunc(capturedAt),
        String(sample.overall || 'unknown'),
        String(sample.nodeStatus || 'unknown'),
        String(sample.minecraftStatus || 'unknown'),
        JSON.stringify(sample.snapshot ?? null),
      )
      saved += 1
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return saved
}

export function getStatusHistoryPoints(fromTime = 0, max = 96): { time: number; status: 'online' | 'offline' }[] {
  const limit = Number.isFinite(Number(max)) ? Math.max(0, Math.trunc(Number(max))) : 96
  if (!limit) return []
  const rows = all(`
    SELECT captured_at, node_status
    FROM status_history
    WHERE captured_at >= ?
    ORDER BY captured_at ASC
  `, Math.max(0, Number(fromTime) || 0))
  const points = rows
    .map((row) => ({
      time: Number(row.captured_at),
      status: ['operational', 'degraded'].includes(String(row.node_status)) ? 'online' as const : 'offline' as const,
    }))
    .filter((point) => Number.isFinite(point.time) && point.time > 0)
  if (points.length <= limit) return points
  return Array.from({ length: limit }, (_, index) => {
    const start = Math.floor(index * points.length / limit)
    const end = Math.floor((index + 1) * points.length / limit)
    const bucket = points.slice(start, Math.max(start + 1, end))
    return {
      time: bucket[bucket.length - 1]!.time,
      status: bucket.some((point) => point.status === 'offline') ? 'offline' as const : 'online' as const,
    }
  })
}

export function getStatusHistoryStats(): StatusHistoryStats {
  const row = get('SELECT COUNT(*) AS count, MIN(captured_at) AS oldest_at, MAX(captured_at) AS latest_at FROM status_history')
  return {
    count: Number(row?.count || 0),
    oldestAt: row?.oldest_at == null ? null : Number(row.oldest_at),
    latestAt: row?.latest_at == null ? null : Number(row.latest_at),
  }
}

/**
 * Return the most recent raw Worker snapshot for a short outage fallback.
 * The payload is parsed here, then validated and normalized by the status
 * adapter before it is ever returned to a client.
 */
export function getLatestStatusHistorySnapshot(): unknown | null {
  const row = get('SELECT snapshot_json FROM status_history ORDER BY captured_at DESC LIMIT 1')
  if (!row?.snapshot_json) return null
  try {
    return JSON.parse(String(row.snapshot_json))
  } catch {
    return null
  }
}

export function clearStatusHistory(): number {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = db.prepare('DELETE FROM status_history').run()
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(STATUS_HISTORY_CLEARED_AT_SETTING, String(Date.now()))
    db.exec('COMMIT')
    return Number(result.changes || 0)
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function getPasswordPolicy(): PasswordPolicy {
  return {
    enabled: getSetting(PASSWORD_POLICY_ENABLED_SETTING) === 'true',
    minimumScore: normalizePasswordPolicyMinimumScore(
      getSetting(PASSWORD_POLICY_MINIMUM_SCORE_SETTING) ?? DEFAULT_PASSWORD_POLICY.minimumScore,
    ),
  }
}

export function setPasswordPolicy(enabledValue: unknown, minimumScoreValue: unknown): PasswordPolicy {
  if (typeof enabledValue !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: '密码复杂度开关参数无效' })
  }
  const rawMinimumScore = Number(minimumScoreValue)
  if (!Number.isInteger(rawMinimumScore) || rawMinimumScore < 1 || rawMinimumScore > 6) {
    throw createError({ statusCode: 400, statusMessage: '最低密码复杂度需要为 1 至 6 级' })
  }
  const minimumScore = rawMinimumScore as PasswordPolicyMinimumScore

  db.exec('BEGIN IMMEDIATE')
  try {
    setSetting(PASSWORD_POLICY_ENABLED_SETTING, enabledValue ? 'true' : 'false')
    setSetting(PASSWORD_POLICY_MINIMUM_SCORE_SETTING, String(minimumScore))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { enabled: enabledValue, minimumScore }
}

export function getPasswordExpiryPolicy(): PasswordExpiryPolicy {
  return {
    enabled: getSetting(PASSWORD_EXPIRY_ENABLED_SETTING) === 'true',
    days: normalizePasswordExpiryDays(
      getSetting(PASSWORD_EXPIRY_DAYS_SETTING) ?? DEFAULT_PASSWORD_EXPIRY_POLICY.days,
    ),
  }
}

export function setPasswordExpiryPolicy(enabledValue: unknown, daysValue: unknown): PasswordExpiryPolicy {
  if (typeof enabledValue !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: '密码有效期开关参数无效' })
  }
  const rawDays = Number(daysValue)
  if (!Number.isInteger(rawDays) || rawDays < MIN_PASSWORD_EXPIRY_DAYS || rawDays > MAX_PASSWORD_EXPIRY_DAYS) {
    throw createError({
      statusCode: 400,
      statusMessage: `密码有效期需要为 ${MIN_PASSWORD_EXPIRY_DAYS} 至 ${MAX_PASSWORD_EXPIRY_DAYS} 天`,
    })
  }
  const days = normalizePasswordExpiryDays(rawDays)
  db.exec('BEGIN IMMEDIATE')
  try {
    setSetting(PASSWORD_EXPIRY_ENABLED_SETTING, enabledValue ? 'true' : 'false')
    setSetting(PASSWORD_EXPIRY_DAYS_SETTING, String(days))
    if (enabledValue) {
      run('UPDATE admin_users SET password_changed_at = ? WHERE password_changed_at <= 0', Date.now())
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { enabled: enabledValue, days }
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
  const currentKey = getGameApiKey()
  if (key === currentKey) {
    setSetting(GAME_API_KEY_SETTING, key)
    return key
  }

  // SMTP 密码使用游戏 API 密钥派生的密钥加密。轮换游戏 API 密钥时先用
  // 当前密钥解密，再在同一事务内使用新密钥重新加密，避免保存站点设置后
  // 已配置的 SMTP 认证立即失效。
  const encryptedSmtpPassword = getSetting(SMTP_PASSWORD_SETTING) || ''
  const smtpPassword = encryptedSmtpPassword ? decryptSmtpPassword(encryptedSmtpPassword) : ''

  db.exec('BEGIN IMMEDIATE')
  try {
    setSetting(GAME_API_KEY_SETTING, key)
    if (smtpPassword) setSetting(SMTP_PASSWORD_SETTING, encryptSmtpPassword(smtpPassword))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
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
  passwordChangedAt: number
  passwordExpiry: PasswordExpiryStatus
  permissions: Record<string, AdminPagePermissionLevel>
  featurePermissions: Record<string, AdminFeaturePermissionLevel>
  navigationPreferences: AdminNavigationPreferences
}

export interface AdminPresence {
  id: number
  username: string
  avatar: string
  fullName: string
  isOwner: boolean
  path: string
  lastSeenAt: number
}

export const ADMIN_PRESENCE_ONLINE_MS = 75_000

function requireAdminPresencePath(value: unknown): string {
  const path = String(value ?? '/').trim()
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 256 || /[\r\n\u0000]/.test(path)) return '/'
  return path.split(/[?#]/, 1)[0] || '/'
}

export function touchAdminPresence(userId: number, pathValue: unknown, now = Date.now()): void {
  run(`
    INSERT INTO admin_presence (user_id, path, last_seen)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET path = excluded.path, last_seen = excluded.last_seen
  `, userId, requireAdminPresencePath(pathValue), now)
}

export function clearAdminPresence(userId: number): void {
  run('DELETE FROM admin_presence WHERE user_id = ?', userId)
}

export function listOnlineAdminPresence(now = Date.now()): AdminPresence[] {
  const cutoff = now - ADMIN_PRESENCE_ONLINE_MS
  run('DELETE FROM admin_presence WHERE last_seen < ?', cutoff)
  return all(`
    SELECT users.id, users.username, users.avatar, users.full_name, users.is_owner,
           presence.path, presence.last_seen
    FROM admin_presence AS presence
    JOIN admin_users AS users ON users.id = presence.user_id
    WHERE presence.last_seen >= ? AND users.is_active = 1
    ORDER BY presence.last_seen DESC, users.username COLLATE NOCASE
  `, cutoff).map((row) => ({
    id: Number(row.id),
    username: String(row.username ?? ''),
    avatar: String(row.avatar ?? ''),
    fullName: String(row.full_name ?? ''),
    isOwner: Number(row.is_owner ?? 0) === 1,
    path: String(row.path ?? '/'),
    lastSeenAt: Number(row.last_seen ?? 0),
  }))
}

function getAdminPagePermissions(userId: number, isOwner: boolean): Record<string, AdminPagePermissionLevel> {
  if (isOwner) return ownerAdminPagePermissions()
  const permissions = defaultAdminPagePermissions()
  for (const row of all('SELECT page_key, level FROM admin_page_permissions WHERE user_id = ?', userId)) {
    const key = String(row.page_key ?? '')
    const level = String(row.level ?? '') as AdminPagePermissionLevel
    const page = ADMIN_PAGE_DEFINITIONS.find((item) => item.key === key)
    if (!page || !['hidden', 'view', 'edit'].includes(level)) continue
    permissions[key] = page.maxNonOwnerLevel === 'hidden'
      ? 'hidden'
      : page.maxNonOwnerLevel === 'view' && level === 'edit'
        ? 'view'
        : level
  }
  for (const page of ADMIN_PAGE_DEFINITIONS) {
    if (page.maxNonOwnerLevel === 'hidden') permissions[page.key] = 'hidden'
  }
  permissions.permissions = permissions.permissions === 'hidden' ? 'hidden' : 'view'
  return permissions
}

function getStoredAdminFeaturePermissions(
  userId: number,
  isOwner: boolean,
): Record<string, AdminFeaturePermissionLevel> {
  if (isOwner) return ownerAdminFeaturePermissions()
  const permissions = defaultAdminFeaturePermissions()
  for (const row of all('SELECT feature_key, level FROM admin_feature_permissions WHERE user_id = ?', userId)) {
    const key = String(row.feature_key ?? '')
    const level = String(row.level ?? '') as AdminFeaturePermissionLevel
    const feature = ADMIN_FEATURE_DEFINITIONS.find((item) => item.key === key)
    const availableLevels = feature?.availableLevels || ['hidden', 'view', 'edit']
    if (!feature || !availableLevels.includes(level)) continue
    permissions[key] = feature.maxNonOwnerLevel === 'hidden'
      ? 'hidden'
      : feature.maxNonOwnerLevel === 'view' && level === 'edit'
        ? 'view'
        : level
  }
  return permissions
}

function capFeatureLevelToPage(
  feature: (typeof ADMIN_FEATURE_DEFINITIONS)[number],
  level: AdminFeaturePermissionLevel,
  pagePermissions: Record<string, AdminPagePermissionLevel>,
): AdminFeaturePermissionLevel {
  if (!feature.pageKey) return level
  const pageLevel = pagePermissions[feature.pageKey] || 'hidden'
  if (pageLevel === 'hidden') return 'hidden'
  if (pageLevel === 'view' && level === 'edit') {
    return (feature.availableLevels || ['hidden', 'view', 'edit']).includes('view') ? 'view' : 'hidden'
  }
  return level
}

function getAdminFeaturePermissions(
  userId: number,
  isOwner: boolean,
  pagePermissions: Record<string, AdminPagePermissionLevel>,
): Record<string, AdminFeaturePermissionLevel> {
  const permissions = getStoredAdminFeaturePermissions(userId, isOwner)
  if (isOwner) return permissions
  for (const feature of ADMIN_FEATURE_DEFINITIONS) {
    permissions[feature.key] = capFeatureLevelToPage(feature, permissions[feature.key]!, pagePermissions)
  }
  return permissions
}

function mapAdminUser(
  row: Record<string, unknown>,
  passwordExpiryPolicy = getPasswordExpiryPolicy(),
): AdminUser {
  const id = Number(row.id)
  const isOwner = Number(row.is_owner ?? 0) === 1
  const createdAt = Number(row.created_at ?? 0)
  const storedPasswordChangedAt = Number(row.password_changed_at ?? 0)
  const passwordChangedAt = storedPasswordChangedAt > 0 ? storedPasswordChangedAt : createdAt
  const permissions = getAdminPagePermissions(id, isOwner)
  return {
    id,
    username: String(row.username ?? ''),
    avatar: String(row.avatar ?? ''),
    fullName: String(row.full_name ?? ''),
    isOwner,
    isActive: Number(row.is_active ?? 0) === 1,
    createdAt,
    passwordChangedAt,
    passwordExpiry: calculatePasswordExpiryStatus(passwordExpiryPolicy, passwordChangedAt),
    permissions,
    featurePermissions: getAdminFeaturePermissions(id, isOwner, permissions),
    navigationPreferences: normalizeAdminNavigationPreferences(row.navigation_preferences),
  }
}

function normalizeAdminPermissions(
  pageInput: Record<string, unknown>,
  featureInput: Record<string, unknown>,
  pageBase: Record<string, AdminPagePermissionLevel>,
  featureBase: Record<string, AdminFeaturePermissionLevel>,
): {
  pages: Record<string, AdminPagePermissionLevel>
  features: Record<string, AdminFeaturePermissionLevel>
} {
  const normalized = { ...pageBase }
  for (const page of ADMIN_PAGE_DEFINITIONS) {
    const requested = String(pageInput?.[page.key] ?? normalized[page.key]) as AdminPagePermissionLevel
    if (!['hidden', 'view', 'edit'].includes(requested)) {
      throw createError({ statusCode: 400, statusMessage: `${page.label}的权限值无效` })
    }
    normalized[page.key] = page.maxNonOwnerLevel === 'hidden'
      ? 'hidden'
      : page.maxNonOwnerLevel === 'view' && requested === 'edit'
        ? 'view'
        : requested
  }

  const normalizedFeatures = { ...featureBase }
  for (const feature of ADMIN_FEATURE_DEFINITIONS) {
    const requested = String(featureInput?.[feature.key] ?? normalizedFeatures[feature.key]) as AdminFeaturePermissionLevel
    const availableLevels = feature.availableLevels || ['hidden', 'view', 'edit']
    if (!availableLevels.includes(requested)) {
      throw createError({ statusCode: 400, statusMessage: `${feature.label}的权限值无效` })
    }
    const level: AdminFeaturePermissionLevel = feature.maxNonOwnerLevel === 'hidden'
      ? 'hidden'
      : feature.maxNonOwnerLevel === 'view' && requested === 'edit'
        ? 'view'
        : requested
    normalizedFeatures[feature.key] = capFeatureLevelToPage(feature, level, normalized)
  }
  return { pages: normalized, features: normalizedFeatures }
}

function writeAdminPermissions(
  userId: number,
  pages: Record<string, AdminPagePermissionLevel>,
  features: Record<string, AdminFeaturePermissionLevel>,
  now: number,
) {
  run('DELETE FROM admin_page_permissions WHERE user_id = ?', userId)
  run('DELETE FROM admin_feature_permissions WHERE user_id = ?', userId)
  for (const page of ADMIN_PAGE_DEFINITIONS) {
    if (pages[page.key] === page.defaultLevel) continue
    run(
      'INSERT INTO admin_page_permissions (user_id, page_key, level, updated_at) VALUES (?, ?, ?, ?)',
      userId, page.key, pages[page.key], now,
    )
  }
  for (const feature of ADMIN_FEATURE_DEFINITIONS) {
    if (features[feature.key] === feature.defaultLevel) continue
    run(
      'INSERT INTO admin_feature_permissions (user_id, feature_key, level, updated_at) VALUES (?, ?, ?, ?)',
      userId, feature.key, features[feature.key], now,
    )
  }
}

export function updateAdminPermissions(
  userId: number,
  pageInput: Record<string, unknown>,
  featureInput: Record<string, unknown>,
  domainMailPrefixes?: unknown,
  domainMailAllMailboxes?: unknown,
): AdminUser {
  const current = getAdminUserById(userId)
  if (!current) throw createError({ statusCode: 404, statusMessage: '后台用户不存在' })
  if (current.isOwner) throw createError({ statusCode: 400, statusMessage: '初始所有者始终拥有全部权限' })
  const normalized = normalizeAdminPermissions(
    pageInput,
    featureInput,
    current.permissions,
    current.featurePermissions,
  )
  const normalizedDomainMailPrefixes = domainMailPrefixes === undefined
    ? undefined
    : requireDomainMailPrefixes(domainMailPrefixes)
  const normalizedDomainMailAllMailboxes = domainMailAllMailboxes === undefined
    ? undefined
    : requireDomainMailAllMailboxes(domainMailAllMailboxes)

  db.exec('BEGIN IMMEDIATE')
  try {
    const now = Date.now()
    writeAdminPermissions(userId, normalized.pages, normalized.features, now)
    if (normalizedDomainMailPrefixes !== undefined) {
      run('DELETE FROM domain_mail_prefix_permissions WHERE user_id = ?', userId)
      for (const prefix of normalizedDomainMailPrefixes) {
        run(`INSERT INTO domain_mail_prefix_permissions (user_id, prefix, created_at, updated_at)
             VALUES (?, ?, ?, ?)`, userId, prefix, now, now)
      }
    }
    if (normalizedDomainMailAllMailboxes !== undefined) {
      run(`INSERT INTO domain_mail_access_settings (user_id, all_mailboxes, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET all_mailboxes = excluded.all_mailboxes, updated_at = excluded.updated_at`,
      userId,
      normalizedDomainMailAllMailboxes ? 1 : 0,
      now,
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return getAdminUserById(userId) as AdminUser
}

export function updateAdminPermissionsBatch(
  userIds: number[],
  pageInput: Record<string, unknown>,
  featureInput: Record<string, unknown>,
): AdminUser[] {
  const targets = userIds.map((userId) => {
    const current = getAdminUserById(userId)
    if (!current) throw createError({ statusCode: 404, statusMessage: `后台用户不存在：${userId}` })
    if (current.isOwner) throw createError({ statusCode: 400, statusMessage: '初始所有者始终拥有全部权限' })
    return {
      userId,
      normalized: normalizeAdminPermissions(
        pageInput,
        featureInput,
        current.permissions,
        current.featurePermissions,
      ),
    }
  })

  db.exec('BEGIN IMMEDIATE')
  try {
    const now = Date.now()
    for (const target of targets) {
      writeAdminPermissions(target.userId, target.normalized.pages, target.normalized.features, now)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return targets.map((target) => getAdminUserById(target.userId) as AdminUser)
}

function getAdminUserById(id: number): AdminUser | undefined {
  const row = get('SELECT id, username, avatar, full_name, navigation_preferences, password_changed_at, is_owner, is_active, created_at FROM admin_users WHERE id = ?', id)
  return row ? mapAdminUser(row) : undefined
}

export function listAdminUsers(): AdminUser[] {
  const passwordExpiryPolicy = getPasswordExpiryPolicy()
  return all('SELECT id, username, avatar, full_name, navigation_preferences, password_changed_at, is_owner, is_active, created_at FROM admin_users ORDER BY is_owner DESC, username COLLATE NOCASE')
    .map(row => mapAdminUser(row, passwordExpiryPolicy))
}

function requireAdminUsername(value: unknown): string {
  const username = String(value ?? '').trim()
  if (!ADMIN_USER_RE.test(username)) {
    throw createError({ statusCode: 400, statusMessage: '用户名需要为 3 至 32 位字母、数字、下划线或连字符' })
  }
  return username
}

function requireAccountPassword(
  value: unknown,
  minLength: number,
  maxLength: number,
  label: string,
): string {
  const password = String(value ?? '')
  if (password.length < minLength || password.length > maxLength) {
    throw createError({ statusCode: 400, statusMessage: `${label}长度需要为 ${minLength} 至 ${maxLength} 位` })
  }
  return password
}

function requireAdminPassword(value: unknown, label = '密码'): string {
  const password = String(value ?? '')
  const passwordLength = Array.from(password).length
  if (passwordLength < 12 || passwordLength > 128) {
    throw createError({ statusCode: 400, statusMessage: `${label}长度需要为 12 至 128 位` })
  }
  const policy = getPasswordPolicy()
  if (!passwordMeetsPolicy(password, 12, policy)) {
    const requirements = passwordPolicyRequirementLabels(policy.minimumScore, 12).join('、')
    const message = `${label}复杂度需要达到“${passwordStrengthLabel(policy.minimumScore)}”：${requirements}`
    throw createError({ statusCode: 400, statusMessage: message, message })
  }
  return password
}

function assertAdminPasswordNotReused(userId: number, password: string, currentHash: string): void {
  const recentHashes = all(`
    SELECT password_hash
    FROM admin_password_history
    WHERE user_id = ?
    ORDER BY changed_at DESC, id DESC
    LIMIT 3
  `, userId).map(row => String(row.password_hash ?? ''))
  if ([currentHash, ...recentHashes].some(hash => hash && verifyGamePassword(password, hash))) {
    throw createError({
      statusCode: 400,
      statusMessage: '新密码不能与当前密码或最近 3 次使用过的密码相同',
    })
  }
}

function rotateAdminPassword(userId: number, password: string, now = Date.now()): void {
  const row = get('SELECT password_hash FROM admin_users WHERE id = ?', userId)
  if (!row) throw createError({ statusCode: 404, statusMessage: '后台用户不存在' })
  const currentHash = String(row.password_hash ?? '')
  assertAdminPasswordNotReused(userId, password, currentHash)
  const passwordHash = hashAdminPassword(password)
  run(
    'INSERT INTO admin_password_history (user_id, password_hash, changed_at) VALUES (?, ?, ?)',
    userId, currentHash, now,
  )
  run(
    'UPDATE admin_users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?',
    passwordHash, now, now, userId,
  )
  run(`
    DELETE FROM admin_password_history
    WHERE user_id = ? AND id NOT IN (
      SELECT id
      FROM admin_password_history
      WHERE user_id = ?
      ORDER BY changed_at DESC, id DESC
      LIMIT 3
    )
  `, userId, userId)
}

export function requireGamePassword(value: unknown, label = '密码'): string {
  return requireAccountPassword(value, 4, 128, label)
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
      'INSERT INTO admin_users (username, password_hash, avatar, full_name, password_changed_at, is_owner, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
      username, hashAdminPassword(password), avatar, fullName, now, isOwner ? 1 : 0, now, now,
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
  if (avatar === DEFAULT_ADMIN_AVATAR) return avatar
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

function requireAdminNavigationKeys(value: unknown, allowedKeys: Set<string>, label: string): string[] {
  if (!Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: `${label}格式无效` })
  }
  const keys: string[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    const key = typeof candidate === 'string' ? candidate : ''
    if (!allowedKeys.has(key)) {
      throw createError({ statusCode: 400, statusMessage: '侧边栏页面权限已发生变化，请刷新后重试' })
    }
    if (seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

export function updateAdminNavigationPreferences(
  userId: number,
  orderValue: unknown,
  hiddenValue: unknown,
): AdminUser {
  const current = getAdminUserById(userId)
  if (!current) throw createError({ statusCode: 404, statusMessage: '后台用户不存在' })
  const allowedOrder = ADMIN_NAVIGATION_ORDER.filter((key) => current.permissions[key] !== 'hidden')
  const allowedKeys = new Set<string>(allowedOrder)
  const order = requireAdminNavigationKeys(orderValue, allowedKeys, '侧边栏顺序')
  const hidden = requireAdminNavigationKeys(hiddenValue, allowedKeys, '侧边栏隐藏项')
  for (const key of allowedOrder) {
    if (!order.includes(key)) order.push(key)
  }
  let allowedIndex = 0
  const mergedOrder = current.navigationPreferences.order.map((key) => (
    allowedKeys.has(key) ? order[allowedIndex++]! : key
  ))
  const lockedHidden = current.navigationPreferences.hidden.filter((key) => !allowedKeys.has(key))
  const preferences: AdminNavigationPreferences = {
    order: mergedOrder,
    hidden: [...hidden, ...lockedHidden],
  }
  run(
    'UPDATE admin_users SET navigation_preferences = ?, updated_at = ? WHERE id = ?',
    JSON.stringify(preferences), Date.now(), userId,
  )
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
      rotateAdminPassword(userId, password)
      run('DELETE FROM sessions WHERE user_id = ?', userId)
    }
    if (active !== undefined) {
      run('UPDATE admin_users SET is_active = ?, updated_at = ? WHERE id = ?', active ? 1 : 0, Date.now(), userId)
      if (!active) run('DELETE FROM sessions WHERE user_id = ?', userId)
    }
    if (password !== undefined || active === false) run('DELETE FROM admin_login_takeovers WHERE user_id = ?', userId)
    if (password !== undefined || active === false) run('DELETE FROM admin_presence WHERE user_id = ?', userId)
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
  run('DELETE FROM admin_login_takeovers WHERE user_id = ?', userId)
  run('DELETE FROM admin_page_permissions WHERE user_id = ?', userId)
  run('DELETE FROM admin_feature_permissions WHERE user_id = ?', userId)
  run('DELETE FROM admin_password_history WHERE user_id = ?', userId)
  clearAdminPresence(userId)
  run('DELETE FROM domain_mail_prefix_permissions WHERE user_id = ?', userId)
  run('DELETE FROM domain_mail_access_settings WHERE user_id = ?', userId)
  run('DELETE FROM domain_mail_sent WHERE user_id = ?', userId)
  run('DELETE FROM domain_mail_reads WHERE user_id = ?', userId)
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

export function adminFeatureAllows(
  user: AdminUser,
  featureKey: string,
  required: 'view' | 'edit',
): boolean {
  const feature = ADMIN_FEATURE_DEFINITIONS.find((item) => item.key === featureKey)
  if (!feature) return false
  if (feature.pageKey && !permissionAllows(user.permissions[feature.pageKey], required)) return false
  return permissionAllows(user.featurePermissions[featureKey], required)
}

/**
 * 多个页面共用的接口：任一页面达到所需权限即可放行。
 * <p>
 * 「服务器管理」和「服务器文件」都要读实例列表，而页面权限中间件按路径只能
 * 认一个页面键，所以这类接口从 {@code pageKeyForApi} 里排除、改由自己判定。
 * </p>
 */
export function requireAnyPagePermission(
  event: H3Event,
  pageKeys: string[],
  required: 'view' | 'edit',
): AdminUser {
  const user = requireAuth(event)
  if (pageKeys.some((key) => permissionAllows(user.permissions[key], required))) return user
  throw createError({
    statusCode: 403,
    statusMessage: required === 'edit' ? '当前账户没有此页面的编辑权限' : '当前账户没有此页面的查看权限',
  })
}

export function requireFeaturePermission(
  event: H3Event,
  featureKey: string,
  required: 'view' | 'edit',
): AdminUser {
  const user = requireAuth(event)
  if (!adminFeatureAllows(user, featureKey, required)) {
    throw createError({
      statusCode: 403,
      statusMessage: required === 'edit' ? '当前账户没有此区域的修改权限' : '当前账户没有此区域的查看权限',
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
  const row = get('SELECT id, username, avatar, full_name, navigation_preferences, password_hash, password_changed_at, is_owner, is_active, created_at FROM admin_users WHERE username = ?', username)
  if (!row || Number(row.is_active) !== 1 || !verifyGamePassword(password, String(row.password_hash ?? ''))) return undefined
  return mapAdminUser(row)
}

interface LoginClientInfo {
  browser: string
  os: string
  device: string
}

export interface AdminLoginSessionState {
  hasSession: boolean
  online: boolean
  sessionCount: number
  latest: {
    createdAt: number
    lastSeenAt: number
    ip: string
    browser: string
    os: string
    device: string
  } | null
}

export function hasSession(token: string): boolean {
  return Boolean(getSessionUser(token))
}

function getSessionUser(token: string): AdminUser | undefined {
  const digest = tokenDigest(token)
  const row = get('SELECT time, user_id, last_seen FROM sessions WHERE token = ?', digest)
  if (!row) return undefined
  const now = Date.now()
  const createdAt = Number(row.time)
  if (!Number.isFinite(createdAt) || createdAt + ADMIN_SESSION_TTL_MS <= now) {
    deleteSession(token)
    return undefined
  }
  const userId = Number(row.user_id)
  const user = Number.isInteger(userId) ? getAdminUserById(userId) : undefined
  if (!user || !user.isActive) {
    deleteSession(token)
    return undefined
  }
  if (Number(row.last_seen ?? 0) < now - 30_000) {
    run('UPDATE sessions SET last_seen = ? WHERE token = ?', now, digest)
  }
  return user
}

export function createSession(token: string, userId: number, ip: string, client: LoginClientInfo) {
  const now = Date.now()
  db.exec('BEGIN IMMEDIATE')
  try {
    run('DELETE FROM sessions WHERE user_id = ?', userId)
    run('DELETE FROM admin_login_takeovers WHERE user_id = ?', userId)
    run('DELETE FROM admin_presence WHERE user_id = ?', userId)
    run(
      'INSERT INTO sessions (token, time, user_id, last_seen, ip, browser, os, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      tokenDigest(token), now, userId, now, ip, client.browser, client.os, client.device,
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function getAdminLoginSessionState(userId: number): AdminLoginSessionState {
  const now = Date.now()
  run('DELETE FROM sessions WHERE time <= ?', now - ADMIN_SESSION_TTL_MS)
  const rows = all(`
    SELECT time, last_seen, ip, browser, os, device
    FROM sessions
    WHERE user_id = ?
    ORDER BY last_seen DESC, time DESC
  `, userId)
  const latestRow = rows[0]
  const latest = latestRow
    ? {
        createdAt: Number(latestRow.time ?? 0),
        lastSeenAt: Math.max(Number(latestRow.last_seen ?? 0), Number(latestRow.time ?? 0)),
        ip: String(latestRow.ip ?? ''),
        browser: String(latestRow.browser ?? ''),
        os: String(latestRow.os ?? ''),
        device: String(latestRow.device ?? ''),
      }
    : null
  return {
    hasSession: rows.length > 0,
    online: rows.some((row) => Math.max(Number(row.last_seen ?? 0), Number(row.time ?? 0)) >= now - ADMIN_ONLINE_WINDOW_MS),
    sessionCount: rows.length,
    latest,
  }
}

export function createAdminLoginTakeover(userId: number, ip: string, client: LoginClientInfo) {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  const expiresAt = now + ADMIN_LOGIN_TAKEOVER_TTL_MS
  db.exec('BEGIN IMMEDIATE')
  try {
    run('DELETE FROM admin_login_takeovers WHERE expires_at <= ? OR user_id = ?', now, userId)
    run(
      'INSERT INTO admin_login_takeovers (token, user_id, ip, browser, os, device, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      tokenDigest(token), userId, ip, client.browser, client.os, client.device, now, expiresAt,
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { token, expiresAt }
}

export function consumeAdminLoginTakeover(tokenValue: unknown, ip: string, client: LoginClientInfo): AdminUser {
  const token = String(tokenValue ?? '').trim()
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    throw createError({ statusCode: 401, statusMessage: '挤下线确认已失效，请重新登录' })
  }
  const row = get(`
    DELETE FROM admin_login_takeovers
    WHERE token = ?
    RETURNING user_id, ip, browser, os, device, expires_at
  `, tokenDigest(token))
  const clientMatches = row
    && String(row.ip ?? '') === ip
    && String(row.browser ?? '') === client.browser
    && String(row.os ?? '') === client.os
    && String(row.device ?? '') === client.device
  if (!row || Number(row.expires_at ?? 0) <= Date.now() || !clientMatches) {
    throw createError({ statusCode: 401, statusMessage: '挤下线确认已失效，请重新登录' })
  }
  const user = getAdminUserById(Number(row.user_id))
  if (!user || !user.isActive) {
    throw createError({ statusCode: 401, statusMessage: '账户已失效，请重新登录' })
  }
  return user
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

export function requireAuth(event: H3Event, options: { allowExpired?: boolean } = {}): AdminUser {
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
  if (user.passwordExpiry.expired && !options.allowExpired) {
    throw createError({
      statusCode: 403,
      statusMessage: '后台密码已过期，请先修改密码',
      data: {
        code: 'ADMIN_PASSWORD_EXPIRED',
        passwordExpiry: user.passwordExpiry,
      },
    })
  }
  event.context.adminUser = user
  return user
}

export function pushLogin(ip: string, time: number, client: LoginClientInfo, username = '', userId?: number) {
  run(
    'INSERT INTO login_history (user_id, ip, time, username, browser, os, device) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId ?? null, ip, time, username, client.browser, client.os, client.device,
  )
  run('DELETE FROM login_history WHERE id NOT IN (SELECT id FROM login_history ORDER BY id DESC LIMIT 5000)')
}

export function listLogins(): Array<{ ip: string; time: number; username: string; browser: string; os: string; device: string }> {
  return all('SELECT ip, time, username, browser, os, device FROM login_history ORDER BY id DESC LIMIT 100') as Array<{
    ip: string
    time: number
    username: string
    browser: string
    os: string
    device: string
  }>
}

export function listAdminAccountDevices(event: H3Event, user: AdminUser) {
  const cookie = getCookie(event, ADMIN_COOKIE_NAME)
  const header = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  const currentToken = cookie || header || ''
  const currentSessionDigest = currentToken ? tokenDigest(currentToken) : ''
  const now = Date.now()
  const historyRows = all(`
    SELECT id, ip, time, browser, os, device
    FROM login_history
    WHERE user_id = ? OR (user_id IS NULL AND username = ? COLLATE NOCASE)
    ORDER BY id DESC
    LIMIT 1000
  `, user.id, user.username)
  const sessionRows = all(`
    SELECT token, ip, time, last_seen, browser, os, device
    FROM sessions
    WHERE user_id = ?
    ORDER BY last_seen DESC, time DESC
  `, user.id)

  const keyFor = (row: Record<string, unknown>) => [
    String(row.device ?? '').trim().toLocaleLowerCase('zh-CN'),
    String(row.browser ?? '').trim().toLocaleLowerCase('en-US'),
    String(row.os ?? '').trim().toLocaleLowerCase('en-US'),
    String(row.ip ?? '').trim(),
  ].join('\u0000')
  const devices = new Map<string, {
    id: string
    device: string
    browser: string
    os: string
    ip: string
    lastLoginAt: number
    loginCount: number
    isCurrent: boolean
    online: boolean
    lastSeenAt: number | null
  }>()

  for (const row of historyRows) {
    const key = keyFor(row)
    const time = Number(row.time ?? 0)
    const existing = devices.get(key)
    if (existing) {
      existing.loginCount += 1
      existing.lastLoginAt = Math.max(existing.lastLoginAt, time)
      continue
    }
    devices.set(key, {
      id: `login-device-${Number(row.id)}`,
      device: String(row.device ?? ''),
      browser: String(row.browser ?? ''),
      os: String(row.os ?? ''),
      ip: String(row.ip ?? ''),
      lastLoginAt: time,
      loginCount: 1,
      isCurrent: false,
      online: false,
      lastSeenAt: null,
    })
  }

  for (const row of sessionRows) {
    const key = keyFor(row)
    const createdAt = Number(row.time ?? 0)
    const lastSeenAt = Math.max(Number(row.last_seen ?? 0), createdAt)
    const isCurrent = String(row.token ?? '') === currentSessionDigest
    const existing = devices.get(key)
    if (existing) {
      existing.isCurrent ||= isCurrent
      existing.online ||= isCurrent && lastSeenAt >= now - ADMIN_ONLINE_WINDOW_MS
      existing.lastSeenAt = Math.max(existing.lastSeenAt || 0, lastSeenAt)
      existing.lastLoginAt = Math.max(existing.lastLoginAt, createdAt)
      continue
    }
    devices.set(key, {
      id: `current-session-${user.id}`,
      device: String(row.device ?? ''),
      browser: String(row.browser ?? ''),
      os: String(row.os ?? ''),
      ip: String(row.ip ?? ''),
      lastLoginAt: createdAt,
      loginCount: 1,
      isCurrent,
      online: isCurrent && lastSeenAt >= now - ADMIN_ONLINE_WINDOW_MS,
      lastSeenAt,
    })
  }

  return [...devices.values()]
    .sort((left, right) => Number(right.isCurrent) - Number(left.isCurrent) || right.lastLoginAt - left.lastLoginAt)
    .slice(0, 20)
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

export function getAuditLogOverview(event: H3Event, currentUser: AdminUser, limit = 500) {
  const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 500
  const safeLimit = Math.min(1000, Math.max(1, normalizedLimit))
  const now = Date.now()
  const cookie = getCookie(event, ADMIN_COOKIE_NAME)
  const header = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  const currentToken = cookie || header || ''
  const currentSessionDigest = currentToken ? tokenDigest(currentToken) : ''

  run('DELETE FROM sessions WHERE time <= ?', now - ADMIN_SESSION_TTL_MS)

  const memberRows = all(`
    SELECT id, username, avatar, full_name, is_owner, is_active, created_at
    FROM admin_users
    ORDER BY is_owner DESC, username COLLATE NOCASE
  `)
  const sessionRows = all(`
    SELECT token, user_id, time, last_seen, ip, browser, os, device
    FROM sessions
    WHERE user_id IS NOT NULL
    ORDER BY last_seen DESC, time DESC
  `)
  const loginRows = all(`
    SELECT id, user_id, username, ip, time, browser, os, device
    FROM login_history
    ORDER BY id DESC
    LIMIT ${safeLimit}
  `)
  const auditRows = all(`
    SELECT id, user_id, username, action, method, path, ip, time
    FROM audit_logs
    WHERE action <> '登录后台'
    ORDER BY id DESC
    LIMIT ${safeLimit}
  `)

  const userIdByUsername = new Map<string, number>()
  for (const row of memberRows) userIdByUsername.set(String(row.username ?? '').toLocaleLowerCase('en-US'), Number(row.id))

  const sessionsByUser = new Map<number, Array<Record<string, unknown>>>()
  for (const row of sessionRows) {
    const userId = Number(row.user_id)
    if (!Number.isInteger(userId)) continue
    const sessions = sessionsByUser.get(userId) || []
    sessions.push(row)
    sessionsByUser.set(userId, sessions)
  }

  const latestLoginByUser = new Map<number, Record<string, unknown>>()
  for (const row of loginRows) {
    const username = String(row.username ?? '')
    const storedUserId = Number(row.user_id)
    const userId = Number.isInteger(storedUserId) && storedUserId > 0
      ? storedUserId
      : userIdByUsername.get(username.toLocaleLowerCase('en-US'))
    if (userId && !latestLoginByUser.has(userId)) latestLoginByUser.set(userId, row)
  }

  const toSession = (row: Record<string, unknown>) => ({
    createdAt: Number(row.time ?? 0),
    lastSeenAt: Math.max(Number(row.last_seen ?? 0), Number(row.time ?? 0)),
    ip: String(row.ip ?? ''),
    browser: String(row.browser ?? ''),
    os: String(row.os ?? ''),
    device: String(row.device ?? ''),
    isCurrent: String(row.token ?? '') === currentSessionDigest,
  })

  const members = memberRows.map((row) => {
    const id = Number(row.id)
    const sessions = (sessionsByUser.get(id) || []).map(toSession)
    const latestLogin = latestLoginByUser.get(id)
    const lastConnection = sessions[0] || (latestLogin
      ? {
          createdAt: Number(latestLogin.time ?? 0),
          lastSeenAt: Number(latestLogin.time ?? 0),
          ip: String(latestLogin.ip ?? ''),
          browser: String(latestLogin.browser ?? ''),
          os: String(latestLogin.os ?? ''),
          device: String(latestLogin.device ?? ''),
          isCurrent: false,
        }
      : null)
    const lastSeenAt = Math.max(
      sessions.reduce((latest, session) => Math.max(latest, session.lastSeenAt), 0),
      Number(latestLogin?.time ?? 0),
    )
    return {
      id,
      username: String(row.username ?? ''),
      avatar: String(row.avatar ?? ''),
      fullName: String(row.full_name ?? ''),
      isOwner: Number(row.is_owner ?? 0) === 1,
      isActive: Number(row.is_active ?? 0) === 1,
      createdAt: Number(row.created_at ?? 0),
      isCurrent: id === currentUser.id,
      loggedIn: sessions.length > 0,
      online: sessions.some((session) => session.lastSeenAt >= now - ADMIN_ONLINE_WINDOW_MS),
      sessionCount: sessions.length,
      lastSeenAt: lastSeenAt || null,
      lastConnection,
    }
  })

  const records = [
    ...auditRows.map((row) => {
      const username = String(row.username ?? '')
      const storedUserId = Number(row.user_id)
      const userId = Number.isInteger(storedUserId) && storedUserId > 0
        ? storedUserId
        : userIdByUsername.get(username.toLocaleLowerCase('en-US')) || null
      const action = String(row.action ?? '')
      return {
        id: `audit-${Number(row.id)}`,
        kind: action === '登出后台' ? 'logout' : 'action',
        userId,
        username,
        action,
        method: String(row.method ?? ''),
        path: String(row.path ?? ''),
        ip: String(row.ip ?? ''),
        time: Number(row.time ?? 0),
        browser: '',
        os: '',
        device: '',
      }
    }),
    ...loginRows.map((row) => {
      const username = String(row.username ?? '')
      const storedUserId = Number(row.user_id)
      const userId = Number.isInteger(storedUserId) && storedUserId > 0
        ? storedUserId
        : userIdByUsername.get(username.toLocaleLowerCase('en-US')) || null
      return {
        id: `login-${Number(row.id)}`,
        kind: 'login',
        userId,
        username,
        action: '连接后台',
        method: 'POST',
        path: '/api/auth/login',
        ip: String(row.ip ?? ''),
        time: Number(row.time ?? 0),
        browser: String(row.browser ?? ''),
        os: String(row.os ?? ''),
        device: String(row.device ?? ''),
      }
    }),
  ].sort((left, right) => right.time - left.time).slice(0, safeLimit)

  const currentAccount = members.find((member) => member.id === currentUser.id)
  const currentSession = (sessionsByUser.get(currentUser.id) || [])
    .map(toSession)
    .find((session) => session.isCurrent) || null

  return {
    generatedAt: now,
    onlineWindowMs: ADMIN_ONLINE_WINDOW_MS,
    currentAccount: currentAccount ? { ...currentAccount, currentSession } : null,
    members,
    records,
  }
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

export type DownloadProjectType = '整合包' | '模组'

export interface DownloadProject {
  id: string
  type: DownloadProjectType
  name: string
  url: string
  version: string
  description: string
  createdAt: number
  updatedAt: number
}

function mapDownloadProject(row: Record<string, unknown>): DownloadProject {
  return {
    id: row.id as string,
    type: row.type as DownloadProjectType,
    name: row.name as string,
    url: row.url as string,
    version: row.version as string,
    description: row.description as string,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  }
}

export function listDownloadProjects(): DownloadProject[] {
  return all('SELECT id, type, name, url, version, description, created_at, updated_at FROM downloads WHERE type IN (\'整合包\', \'模组\') ORDER BY rowid DESC').map(mapDownloadProject)
}

export function insertDownloadProject(item: DownloadProject) {
  run(
    'INSERT INTO downloads (id, type, name, url, version, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    item.id,
    item.type,
    item.name,
    item.url,
    item.version,
    item.description,
    item.createdAt,
    item.updatedAt,
  )
}

export function updateDownloadProject(item: DownloadProject) {
  run(
    'UPDATE downloads SET type = ?, name = ?, url = ?, version = ?, description = ?, updated_at = ? WHERE id = ?',
    item.type,
    item.name,
    item.url,
    item.version,
    item.description,
    item.updatedAt,
    item.id,
  )
}

export function deleteDownloadProject(id: string) {
  run('DELETE FROM downloads WHERE id = ?', id)
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
  verifySignedRequest(event, body, requireConfiguredGameApiKey(), '服务器 Api 请求签名无效')
  event.context.yzwcGameRequestAuthenticated = true
}

/**
 * 校验 Cloudflare Email Worker 投递收件的签名。
 * <p>
 * 与游戏 Api 用同一套规范串和防重放表，但密钥独立：站点设置里保存的
 * {@code inbound_mail.key} 优先，未配置时回退到环境变量
 * {@code YZWC_INBOUND_MAIL_KEY}。两边互不通用。
 * </p>
 */
export function authenticateInboundMailRequest(event: H3Event, body: Buffer): void {
  verifySignedRequest(event, body, requireInboundMailKey(), '收件投递请求签名无效')
  event.context.yzwcInboundMailAuthenticated = true
}

export function requireInboundMailAuth(event: H3Event): void {
  if (event.context.yzwcInboundMailAuthenticated === true) return
  throw createError({ statusCode: 401, statusMessage: '收件投递请求签名无效' })
}

function requireInboundMailKey(): string {
  const key = getInboundMailKey()
  if (!inboundMailKeyUsable(key)) {
    throw createError({
      statusCode: 503,
      statusMessage: '域名邮件投递密钥未配置或长度无效，请在站点设置中填写',
    })
  }
  return key
}

function requireInboundMailKeyValue(value: unknown): string {
  const key = String(value ?? '').trim()
  if (!inboundMailKeyUsable(key)) {
    throw createError({
      statusCode: 400,
      statusMessage: '域名邮件投递密钥长度需要为 32 至 512 位且不能包含空白字符',
    })
  }
  return key
}

function inboundMailKeyUsable(key: string): boolean {
  return key.length >= 32 && key.length <= 512 && !/\s/.test(key)
}

/** 返回数据库中配置的密钥；未配置时兼容使用环境变量。与 getGameApiKey 同一套优先级。 */
export function getInboundMailKey(): string {
  return getSetting(INBOUND_MAIL_KEY_SETTING)?.trim() || process.env[INBOUND_MAIL_KEY_ENV]?.trim() || ''
}

export function setInboundMailKey(value: unknown): string {
  const key = requireInboundMailKeyValue(value)
  setSetting(INBOUND_MAIL_KEY_SETTING, key)
  return key
}

/** 密钥来源：settings 表优先，其次环境变量。用于在设置页说明当前生效的是哪一份。 */
export function inboundMailKeySource(): 'database' | 'env' | 'none' {
  if (inboundMailKeyUsable(getSetting(INBOUND_MAIL_KEY_SETTING)?.trim() || '')) return 'database'
  if (inboundMailKeyUsable(process.env[INBOUND_MAIL_KEY_ENV]?.trim() || '')) return 'env'
  return 'none'
}

export function inboundMailConfigured(): boolean {
  return inboundMailKeyUsable(getInboundMailKey())
}

/** 设置项来源：settings 表优先，其次环境变量。用于在设置页说明当前生效的是哪一份。 */
export type SettingSource = 'database' | 'env' | 'none'

export interface McsmConfig {
  baseUrl: string
  apiKey: string
}

/** 回给具备 MCSM 设置查看权限的后台页面。 */
export interface McsmAdminConfig {
  baseUrl: string
  baseUrlSource: SettingSource
  /** 按设置页权限回传当前生效的明文 ApiKey，供管理员核对或复制。 */
  apiKey: string
  apiKeyConfigured: boolean
  apiKeySource: SettingSource
  configured: boolean
}

/**
 * 校验并规范化 MCSM 面板地址。
 * <p>
 * 只接受 http/https，允许反向代理下的路径前缀（面板支持 path prefix），
 * 但不接受查询串、片段和 URL 内嵌账号密码——这些要么无意义，要么会把凭据写进日志。
 * 末尾斜杠统一去掉，方便后面直接拼 {@code /api/...}。
 * </p>
 */
function requireMcsmBaseUrl(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > 256) {
    throw createError({ statusCode: 400, statusMessage: 'MCSM 面板地址不能为空且不能超过 256 个字符' })
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'MCSM 面板地址必须是完整 URL，例如 http://127.0.0.1:23333' })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw createError({ statusCode: 400, statusMessage: 'MCSM 面板地址只支持 http 或 https' })
  }
  if (url.username || url.password || url.search || url.hash) {
    throw createError({ statusCode: 400, statusMessage: 'MCSM 面板地址不能包含账号密码、查询串或片段' })
  }
  const prefix = url.pathname.replace(/\/+$/, '')
  if (prefix && !/^(?:\/[A-Za-z0-9._~-]+)+$/.test(prefix)) {
    throw createError({ statusCode: 400, statusMessage: 'MCSM 面板地址的路径前缀含有不支持的字符' })
  }
  return `${url.protocol}//${url.host}${prefix}`
}

/** 面板 ApiKey：面板生成的是 32 位十六进制串，这里放宽到 16~256 位无空白字符。 */
function requireMcsmApiKey(value: unknown): string {
  const key = String(value ?? '').trim()
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(key)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'MCSM ApiKey 需要为 16 至 256 位的字母、数字、下划线或短横线',
    })
  }
  return key
}

function settingSource(settingKey: string, envName: string): SettingSource {
  if (getSetting(settingKey)?.trim()) return 'database'
  if (process.env[envName]?.trim()) return 'env'
  return 'none'
}

/** 服务端调用面板时使用的完整配置。 */
export function getMcsmConfig(): McsmConfig {
  return {
    baseUrl: getSetting(MCSM_BASE_URL_SETTING)?.trim() || process.env[MCSM_BASE_URL_ENV]?.trim() || '',
    apiKey: getSetting(MCSM_API_KEY_SETTING)?.trim() || process.env[MCSM_API_KEY_ENV]?.trim() || '',
  }
}

export function mcsmConfigured(): boolean {
  const config = getMcsmConfig()
  return Boolean(config.baseUrl && config.apiKey)
}

export function getAdminMcsmConfig(): McsmAdminConfig {
  const config = getMcsmConfig()
  return {
    baseUrl: config.baseUrl,
    baseUrlSource: settingSource(MCSM_BASE_URL_SETTING, MCSM_BASE_URL_ENV),
    apiKey: config.apiKey,
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeySource: settingSource(MCSM_API_KEY_SETTING, MCSM_API_KEY_ENV),
    configured: Boolean(config.baseUrl && config.apiKey),
  }
}

/**
 * 保存 MCSM 面板配置。
 * <p>
 * ApiKey 留空仍表示沿用已有值，兼容旧版页面和只修改地址的调用方。
 * </p>
 */
export function setMcsmConfig(input: { baseUrl?: unknown; apiKey?: unknown }): McsmAdminConfig {
  const current = getMcsmConfig()
  const baseUrl = requireMcsmBaseUrl(input.baseUrl)
  const provided = String(input.apiKey ?? '').trim()
  const apiKey = provided ? requireMcsmApiKey(provided) : current.apiKey
  if (!apiKey) {
    throw createError({ statusCode: 400, statusMessage: '首次配置 MCSM 面板时必须填写 ApiKey' })
  }
  setSetting(MCSM_BASE_URL_SETTING, baseUrl)
  setSetting(MCSM_API_KEY_SETTING, apiKey)
  return getAdminMcsmConfig()
}

/**
 * HMAC-SHA256 请求签名校验：时间窗 + nonce 防重放 + 规范串
 * {@code timestamp.nonce.METHOD.path.sha256(body)}。
 */
function verifySignedRequest(event: H3Event, body: Buffer, secret: string, failureMessage: string): void {
  const timestamp = getHeader(event, 'x-yzwc-timestamp') || ''
  const nonce = getHeader(event, 'x-yzwc-nonce') || ''
  const provided = getHeader(event, 'x-yzwc-signature') || ''
  const timestampSeconds = Number(timestamp)
  if (!/^\d{10,}$/.test(timestamp) || !Number.isSafeInteger(timestampSeconds)
      || Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > GAME_REQUEST_MAX_SKEW_SECONDS
      || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)
      || !/^[a-f0-9]{64}$/i.test(provided)) {
    throw createError({ statusCode: 401, statusMessage: failureMessage })
  }
  const method = event.method.toUpperCase()
  const bodyHash = createHash('sha256').update(body).digest('hex')
  const canonical = `${timestamp}.${nonce}.${method}.${event.path}.${bodyHash}`
  const expectedSignature = createHmac('sha256', secret).update(canonical).digest('hex')
  if (!safeEqualHex(provided, expectedSignature)) {
    throw createError({ statusCode: 401, statusMessage: failureMessage })
  }
  const now = Date.now()
  run('DELETE FROM api_request_nonces WHERE expires_at <= ?', now)
  try {
    run('INSERT INTO api_request_nonces (nonce, expires_at) VALUES (?, ?)', nonce, now + GAME_REQUEST_NONCE_TTL_MS)
  } catch {
    throw createError({ statusCode: 409, statusMessage: '请求重复提交' })
  }
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

export interface GameStatsRecord {
  uuid: string
  username: string
  lastUpdated: number
  uploadedAt: number
  stats: Record<string, number>
}

const GAME_STATS_MAX_BATCH = 500
const GAME_STATS_MAX_KEYS = 96
const GAME_STATS_MAX_JSON_BYTES = 32 * 1024
const GAME_STATS_KEY_RE = /^[A-Za-z0-9_.:-]{1,64}$/

function normalizeGameStats(value: unknown): Record<string, number> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: '统计数据格式不正确' })
  }
  const result: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!GAME_STATS_KEY_RE.test(key)) {
      throw createError({ statusCode: 400, statusMessage: '统计项目名称不正确' })
    }
    const number = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isSafeInteger(number) || number < 0) {
      throw createError({ statusCode: 400, statusMessage: '统计项目数值不正确' })
    }
    result[key] = number
    if (Object.keys(result).length > GAME_STATS_MAX_KEYS) {
      throw createError({ statusCode: 400, statusMessage: `统计项目最多 ${GAME_STATS_MAX_KEYS} 项` })
    }
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > GAME_STATS_MAX_JSON_BYTES) {
    throw createError({ statusCode: 400, statusMessage: '统计数据过大' })
  }
  return result
}

function normalizeGameStatsTimestamps(value: unknown): Record<string, number> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!GAME_STATS_KEY_RE.test(key)) continue
    const number = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isSafeInteger(number) || number < 0) continue
    result[key] = number
    if (Object.keys(result).length >= GAME_STATS_MAX_KEYS) break
  }
  return result
}

function storedGameStats(row: Record<string, unknown> | undefined): Record<string, number> {
  if (!row) return {}
  try {
    return normalizeGameStats(JSON.parse(String(row.stats_json ?? '{}')))
  } catch {
    return {}
  }
}

function storedGameStatsTimestamps(row: Record<string, unknown> | undefined): Record<string, number> {
  if (!row) return {}
  try {
    return normalizeGameStatsTimestamps(JSON.parse(String(row.stats_updated_json ?? '{}')))
  } catch {
    return {}
  }
}

function storedGameStatsSource(row: Record<string, unknown> | undefined): Record<string, number> {
  if (!row) return {}
  try {
    return normalizeGameStats(JSON.parse(String(row.stats_source_json ?? '{}')))
  } catch {
    return {}
  }
}

function mapGameStats(row: Record<string, unknown>): GameStatsRecord {
  let stats: Record<string, number> = {}
  try {
    stats = storedGameStats(row)
  } catch {
    stats = {}
  }
  return {
    uuid: String(row.player_uuid ?? '').toLowerCase(),
    username: String(row.username ?? ''),
    lastUpdated: Number(row.last_updated ?? 0),
    uploadedAt: Number(row.uploaded_at ?? 0),
    stats,
  }
}

export function upsertGameStats(records: Array<{
  uuid: unknown
  username: unknown
  lastUpdated: unknown
  stats: unknown
}>, mode: 'delta' | 'reset' | 'replace' = 'replace', resetId?: unknown): number {
  if (!Array.isArray(records) || records.length > GAME_STATS_MAX_BATCH) {
    throw createError({ statusCode: 400, statusMessage: `一次最多上传 ${GAME_STATS_MAX_BATCH} 位玩家` })
  }
  const normalizedResetId = resetId == null ? '' : String(resetId).trim()
  if (mode === 'reset' && !/^[A-Za-z0-9_.:-]{1,128}$/.test(normalizedResetId)) {
    throw createError({ statusCode: 400, statusMessage: '统计重置批次编号不正确' })
  }
  const normalized = records.map((record) => {
    const uuid = requirePlayerUuid(record?.uuid)
    const username = requireGameUsername(record?.username)
    const lastUpdated = Number(record?.lastUpdated ?? 0)
    if (!Number.isSafeInteger(lastUpdated) || lastUpdated < 0) {
      throw createError({ statusCode: 400, statusMessage: '统计更新时间不正确' })
    }
    const stats = normalizeGameStats(record?.stats)
    return { uuid, username, lastUpdated, stats }
  })
  const uploadedAt = Date.now()
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const record of normalized) {
      const existing = get(`SELECT last_updated, stats_json, stats_updated_json,
          stats_source_json, last_reset_id
        FROM game_player_stats WHERE player_uuid = ?`, record.uuid)
      const existingStats = storedGameStats(existing)
      const existingTimestamps = storedGameStatsTimestamps(existing)
      const existingSource = storedGameStatsSource(existing)
      let mergedStats: Record<string, number>
      let mergedTimestamps: Record<string, number>
      let mergedSource: Record<string, number>
      let mergedResetId = String(existing?.last_reset_id ?? '')

      if (mode === 'delta') {
        mergedStats = { ...existingStats }
        mergedTimestamps = { ...existingTimestamps }
        mergedSource = { ...existingSource }
        for (const [key, value] of Object.entries(record.stats)) {
          const previousUpdated = mergedTimestamps[key]
          if (previousUpdated != null && record.lastUpdated < previousUpdated) continue
          const previousSource = mergedSource[key] ?? existingStats[key] ?? 0
          const increment = value >= previousSource ? value - previousSource : value
          mergedStats[key] = (mergedStats[key] ?? 0) + increment
          mergedSource[key] = value
          mergedTimestamps[key] = record.lastUpdated
        }
      } else if (mode === 'reset') {
        if (existing != null && mergedResetId === normalizedResetId) continue
        const previousRecordUpdated = existing == null ? 0 : Number(existing.last_updated ?? 0)
        if (existing != null && record.lastUpdated < previousRecordUpdated) continue
        mergedStats = { ...existingStats }
        mergedTimestamps = {}
        mergedSource = {}
        const sourceKeys = new Set([
          ...Object.keys(existingStats),
          ...Object.keys(existingSource),
          ...Object.keys(record.stats),
        ])
        for (const key of Object.keys(record.stats)) {
          const previousSource = existingSource[key] ?? existingStats[key] ?? 0
          const value = record.stats[key]
          const increment = value >= previousSource ? value - previousSource : value
          mergedStats[key] = (mergedStats[key] ?? 0) + increment
        }
        for (const key of sourceKeys) {
          mergedSource[key] = 0
          mergedTimestamps[key] = record.lastUpdated
        }
        mergedResetId = normalizedResetId
      } else {
        const previousUpdated = existing == null ? 0 : Number(existing.last_updated ?? 0)
        if (existing != null && record.lastUpdated < previousUpdated) {
          mergedStats = existingStats
          mergedTimestamps = existingTimestamps
          mergedSource = existingSource
        } else {
          mergedStats = { ...record.stats }
          mergedTimestamps = Object.fromEntries(
            Object.keys(record.stats).map((key) => [key, record.lastUpdated]),
          )
          mergedSource = { ...record.stats }
        }
      }
      const normalizedMergedStats = normalizeGameStats(mergedStats)
      const normalizedMergedSource = normalizeGameStats(mergedSource)
      run(`INSERT INTO game_player_stats
        (player_uuid, username, last_updated, stats_json, stats_updated_json,
         stats_source_json, last_reset_id, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_uuid) DO UPDATE SET
          username = excluded.username,
          last_updated = MAX(game_player_stats.last_updated, excluded.last_updated),
          stats_json = excluded.stats_json,
          stats_updated_json = excluded.stats_updated_json,
          stats_source_json = excluded.stats_source_json,
          last_reset_id = excluded.last_reset_id,
          uploaded_at = excluded.uploaded_at`,
      record.uuid, record.username, record.lastUpdated, JSON.stringify(normalizedMergedStats),
      JSON.stringify(mergedTimestamps), JSON.stringify(normalizedMergedSource), mergedResetId, uploadedAt)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return normalized.length
}

export function listGameStats(): GameStatsRecord[] {
  return all('SELECT * FROM game_player_stats ORDER BY username COLLATE NOCASE, player_uuid').map(mapGameStats)
}

export function listGameStatsOverview(): GameStatsRecord[] {
  return listGameStats()
}

export function getGameStatsByUuid(uuidValue: unknown): GameStatsRecord | undefined {
  const uuid = requirePlayerUuid(uuidValue)
  const row = get('SELECT * FROM game_player_stats WHERE player_uuid = ?', uuid)
  return row ? mapGameStats(row) : undefined
}

export function deleteGameStats(uuidValue: unknown): boolean {
  const uuid = requirePlayerUuid(uuidValue)
  const result = run('DELETE FROM game_player_stats WHERE player_uuid = ?', uuid)
  return Number(result.changes ?? 0) > 0
}

export function deleteGameAccount(username: string): boolean {
  const key = username.trim().toLocaleLowerCase('en-US')
  const existing = get('SELECT username, uuid FROM game_accounts WHERE username_lower = ?', key)
  const result = run('DELETE FROM game_accounts WHERE username_lower = ?', key)
  const uuid = existing?.uuid == null || String(existing.uuid).trim() === ''
    ? offlinePlayerUuid(String(existing?.username ?? username))
    : String(existing.uuid).trim().toLowerCase()
  run('DELETE FROM game_player_stats WHERE player_uuid = ?', uuid)
  run('DELETE FROM game_player_title_grants WHERE username_lower = ?', key)
  run('DELETE FROM game_player_title_selection WHERE username_lower = ?', key)
  run('DELETE FROM game_sessions WHERE username_lower = ?', key)
  run('DELETE FROM game_registration_sessions WHERE username_lower = ?', key)
  run('DELETE FROM game_password_reset_sessions WHERE username_lower = ?', key)
  run('DELETE FROM game_email_change_sessions WHERE username_lower = ?', key)
  return Number(result.changes ?? 0) > 0
}

export type GameTitleRenderType = 'text' | 'texture' | 'text_texture'

export interface GameTitle {
  id: string
  displayName: string
  renderType: GameTitleRenderType
  textContent: string
  textColor: string
  bold: boolean
  italic: boolean
  textureKey: string
  fontId: string
  glyph: string
  enabled: boolean
  sortOrder: number
  systemManaged: boolean
  createdAt: number
  updatedAt: number
}

export interface GameTitleGrant {
  titleId: string
  source: 'registration' | 'manual' | 'permission'
  sourceKey: string
  grantedBy: string
  createdAt: number
}

export interface GamePlayerTitleSnapshot {
  username: string
  usernameLower: string
  uuid: string | null
  ownedTitleIds: string[]
  equippedTitleId: string | null
  grants: GameTitleGrant[]
}

function mapGameTitle(row: Record<string, unknown>): GameTitle {
  return {
    id: String(row.id ?? ''),
    displayName: String(row.display_name ?? ''),
    renderType: String(row.render_type ?? 'text') as GameTitleRenderType,
    textContent: String(row.text_content ?? ''),
    textColor: String(row.text_color ?? '#FFFFFF'),
    bold: Number(row.bold ?? 0) === 1,
    italic: Number(row.italic ?? 0) === 1,
    textureKey: String(row.texture_key ?? ''),
    fontId: String(row.font_id ?? 'youzaiworldcore:title'),
    glyph: String(row.glyph ?? ''),
    enabled: Number(row.enabled ?? 0) === 1,
    sortOrder: Number(row.sort_order ?? 0),
    systemManaged: Number(row.system_managed ?? 0) === 1,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  }
}

export function gameTitleWire(title: GameTitle) {
  return {
    id: title.id,
    display_name: title.displayName,
    render_type: title.renderType,
    text_content: title.textContent,
    text_color: title.textColor,
    bold: title.bold,
    italic: title.italic,
    texture_key: title.textureKey,
    font_id: title.fontId,
    glyph: title.glyph,
    enabled: title.enabled,
    sort_order: title.sortOrder,
    system_managed: title.systemManaged,
    created_at: title.createdAt,
    updated_at: title.updatedAt,
  }
}

export function gamePlayerTitleSnapshotWire(snapshot: GamePlayerTitleSnapshot) {
  return {
    username: snapshot.username,
    username_lower: snapshot.usernameLower,
    uuid: snapshot.uuid,
    owned_title_ids: snapshot.ownedTitleIds,
    equipped_title_id: snapshot.equippedTitleId,
    grants: snapshot.grants.map((grant) => ({
      title_id: grant.titleId,
      source: grant.source,
      source_key: grant.sourceKey,
      granted_by: grant.grantedBy,
      created_at: grant.createdAt,
    })),
  }
}

export function listGameTitles(includeDisabled = true): GameTitle[] {
  const condition = includeDisabled ? '' : 'WHERE enabled = 1'
  return all(`SELECT * FROM game_titles ${condition} ORDER BY sort_order, id`).map(mapGameTitle)
}

export function getGameTitle(idValue: unknown): GameTitle | undefined {
  const id = String(idValue ?? '').trim().toLocaleLowerCase('en-US')
  const row = get('SELECT * FROM game_titles WHERE id = ?', id)
  return row ? mapGameTitle(row) : undefined
}

export function saveGameTitle(input: Partial<GameTitle> & Pick<GameTitle, 'id' | 'displayName'>): GameTitle {
  const id = input.id.trim().toLocaleLowerCase('en-US')
  if (!/^[a-z0-9_]{2,64}$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: '称号 ID 只能包含小写字母、数字和下划线' })
  }
  const displayName = input.displayName.trim()
  if (displayName.length < 1 || displayName.length > 32) {
    throw createError({ statusCode: 400, statusMessage: '称号名称长度需要为 1 至 32 个字符' })
  }
  const existing = getGameTitle(id)
  const renderType = input.renderType ?? existing?.renderType ?? 'text'
  if (!['text', 'texture', 'text_texture'].includes(renderType)) {
    throw createError({ statusCode: 400, statusMessage: '称号渲染类型不正确' })
  }
  const textContent = String(input.textContent ?? existing?.textContent ?? displayName).trim().slice(0, 64)
  const textColor = String(input.textColor ?? existing?.textColor ?? '#FFFFFF').trim().toUpperCase()
  if (!/^#[0-9A-F]{6}$/.test(textColor)) {
    throw createError({ statusCode: 400, statusMessage: '称号颜色必须使用 #RRGGBB 格式' })
  }
  const textureKey = String(input.textureKey ?? existing?.textureKey ?? '').trim()
  if (textureKey && !/^[a-z0-9_./-]{1,128}$/.test(textureKey)) {
    throw createError({ statusCode: 400, statusMessage: '贴图资源标识格式不正确' })
  }
  const fontId = String(input.fontId ?? existing?.fontId ?? 'youzaiworldcore:title').trim()
  if (fontId.length > 128) {
    throw createError({ statusCode: 400, statusMessage: '字体资源标识不能超过 128 个字符' })
  }
  if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(fontId)) {
    throw createError({ statusCode: 400, statusMessage: '字体资源标识格式不正确' })
  }
  const glyph = String(input.glyph ?? existing?.glyph ?? '').slice(0, 8)
  if ((renderType === 'texture' || renderType === 'text_texture') && (!textureKey || !glyph)) {
    throw createError({ statusCode: 400, statusMessage: '贴图称号必须填写贴图标识和字体字符' })
  }
  const now = Date.now()
  run(`INSERT INTO game_titles
      (id, display_name, render_type, text_content, text_color, bold, italic, texture_key,
       font_id, glyph, enabled, sort_order, system_managed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        render_type = excluded.render_type,
        text_content = excluded.text_content,
        text_color = excluded.text_color,
        bold = excluded.bold,
        italic = excluded.italic,
        texture_key = excluded.texture_key,
        font_id = excluded.font_id,
        glyph = excluded.glyph,
        enabled = excluded.enabled,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at`,
    id, displayName, renderType, textContent, textColor,
    (input.bold ?? existing?.bold ?? false) ? 1 : 0,
    (input.italic ?? existing?.italic ?? false) ? 1 : 0,
    textureKey, fontId, glyph,
    (input.enabled ?? existing?.enabled ?? true) ? 1 : 0,
    Math.max(-100_000, Math.min(100_000, Math.trunc(input.sortOrder ?? existing?.sortOrder ?? 0))),
    (existing?.systemManaged ?? input.systemManaged ?? false) ? 1 : 0,
    existing?.createdAt ?? now, now)
  if (input.enabled === false) {
    run('DELETE FROM game_player_title_selection WHERE title_id = ?', id)
  }
  return getGameTitle(id)!
}

function titleGrantRows(usernameLower: string): GameTitleGrant[] {
  return all(`SELECT title_id, source, source_key, granted_by, created_at
              FROM game_player_title_grants
              WHERE username_lower = ?
              ORDER BY created_at, title_id`, usernameLower).map((row) => ({
    titleId: String(row.title_id ?? ''),
    source: String(row.source ?? 'manual') as GameTitleGrant['source'],
    sourceKey: String(row.source_key ?? ''),
    grantedBy: String(row.granted_by ?? ''),
    createdAt: Number(row.created_at ?? 0),
  }))
}

function clearInvalidGameTitleSelection(usernameLower: string): void {
  run(`DELETE FROM game_player_title_selection
       WHERE username_lower = ?
         AND NOT EXISTS (
           SELECT 1
           FROM game_player_title_grants AS grant_row
           JOIN game_titles AS title ON title.id = grant_row.title_id AND title.enabled = 1
           WHERE grant_row.username_lower = game_player_title_selection.username_lower
             AND grant_row.title_id = game_player_title_selection.title_id
         )`, usernameLower)
}

export function getGamePlayerTitleSnapshot(usernameValue: unknown): GamePlayerTitleSnapshot {
  const account = getGameAccount(String(usernameValue ?? ''))
  if (!account) throw createError({ statusCode: 404, statusMessage: '游戏账户不存在' })
  clearInvalidGameTitleSelection(account.usernameLower)
  const grants = titleGrantRows(account.usernameLower)
  const enabledTitleIds = new Set(listGameTitles(false).map((title) => title.id))
  const ownedTitleIds = [...new Set(grants.map((grant) => grant.titleId).filter((id) => enabledTitleIds.has(id)))]
  const selected = get('SELECT title_id FROM game_player_title_selection WHERE username_lower = ?', account.usernameLower)
  const equippedTitleId = selected && ownedTitleIds.includes(String(selected.title_id ?? ''))
    ? String(selected.title_id)
    : null
  return {
    username: account.username,
    usernameLower: account.usernameLower,
    uuid: account.uuid,
    ownedTitleIds,
    equippedTitleId,
    grants,
  }
}

export function listGamePlayerTitleSnapshots(): GamePlayerTitleSnapshot[] {
  return listGameAccounts().map((account) => getGamePlayerTitleSnapshot(account.username))
}

const PERMISSION_GAME_TITLE_IDS = new Set(['admin_junior', 'admin_middle', 'admin_senior'])

export function syncPermissionGameTitles(players: Array<{ username: string, titleIds: string[] }>): GamePlayerTitleSnapshot[] {
  db.exec('BEGIN IMMEDIATE')
  try {
    const snapshots: GamePlayerTitleSnapshot[] = []
    for (const player of players) {
      const account = getGameAccount(player.username)
      if (!account) continue
      const titleIds = [...new Set(player.titleIds
        .map((id) => String(id).trim().toLocaleLowerCase('en-US'))
        .filter((id) => PERMISSION_GAME_TITLE_IDS.has(id)))]
      run(`DELETE FROM game_player_title_grants
           WHERE username_lower = ? AND source = 'permission'`, account.usernameLower)
      for (const titleId of titleIds) {
        run(`INSERT OR IGNORE INTO game_player_title_grants
             (username_lower, title_id, source, source_key, granted_by, created_at)
             VALUES (?, ?, 'permission', ?, 'minecraft_server', ?)`,
        account.usernameLower, titleId, titleId, Date.now())
      }
      clearInvalidGameTitleSelection(account.usernameLower)
      snapshots.push(getGamePlayerTitleSnapshot(account.username))
    }
    db.exec('COMMIT')
    return snapshots
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function setGamePlayerEquippedTitle(usernameValue: unknown, titleIdValue: unknown): GamePlayerTitleSnapshot {
  const account = getGameAccount(String(usernameValue ?? ''))
  if (!account) throw createError({ statusCode: 404, statusMessage: '游戏账户不存在' })
  const titleId = String(titleIdValue ?? '').trim().toLocaleLowerCase('en-US')
  if (!titleId) {
    run('DELETE FROM game_player_title_selection WHERE username_lower = ?', account.usernameLower)
    return getGamePlayerTitleSnapshot(account.username)
  }
  const owned = get(`SELECT 1
                     FROM game_player_title_grants AS grant_row
                     JOIN game_titles AS title ON title.id = grant_row.title_id AND title.enabled = 1
                     WHERE grant_row.username_lower = ? AND grant_row.title_id = ?
                     LIMIT 1`, account.usernameLower, titleId)
  if (!owned) throw createError({ statusCode: 403, statusMessage: '玩家尚未拥有此称号' })
  run(`INSERT INTO game_player_title_selection (username_lower, title_id, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(username_lower) DO UPDATE SET title_id = excluded.title_id, updated_at = excluded.updated_at`,
  account.usernameLower, titleId, Date.now())
  return getGamePlayerTitleSnapshot(account.username)
}

export function grantGameTitleManually(usernameValue: unknown, titleIdValue: unknown, grantedBy: string): GamePlayerTitleSnapshot {
  const account = getGameAccount(String(usernameValue ?? ''))
  if (!account) throw createError({ statusCode: 404, statusMessage: '游戏账户不存在' })
  const title = getGameTitle(titleIdValue)
  if (!title) throw createError({ statusCode: 404, statusMessage: '称号不存在' })
  run(`INSERT OR IGNORE INTO game_player_title_grants
       (username_lower, title_id, source, source_key, granted_by, created_at)
       VALUES (?, ?, 'manual', 'admin', ?, ?)`, account.usernameLower, title.id, grantedBy.slice(0, 64), Date.now())
  return getGamePlayerTitleSnapshot(account.username)
}

export function revokeEditableGameTitleGrants(usernameValue: unknown, titleIdValue: unknown): GamePlayerTitleSnapshot {
  const account = getGameAccount(String(usernameValue ?? ''))
  if (!account) throw createError({ statusCode: 404, statusMessage: '游戏账户不存在' })
  const titleId = String(titleIdValue ?? '').trim().toLocaleLowerCase('en-US')
  run(`DELETE FROM game_player_title_grants
       WHERE username_lower = ? AND title_id = ? AND source <> 'permission'`, account.usernameLower, titleId)
  clearInvalidGameTitleSelection(account.usernameLower)
  return getGamePlayerTitleSnapshot(account.username)
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

function smtpEncryptionKey(secret = requireConfiguredGameApiKey()): Buffer {
  return createHash('sha256').update(`yzwc-smtp:${secret}`).digest()
}

function encryptSmtpPassword(password: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', smtpEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`
}

function decryptSmtpPassword(payload: string): string {
  const [version, ivText, tagText, encryptedText] = payload.split('.')
  if (version !== 'v1' || !ivText || !tagText || !encryptedText) {
    throw createError({ statusCode: 503, message: 'SMTP 密码无法解密，请重新保存 SMTP 配置' })
  }

  const configuredSecret = requireConfiguredGameApiKey()
  const legacyEnvironmentSecret = process.env[GAME_API_KEY_ENV]?.trim() || ''
  const candidateSecrets = [configuredSecret]
  if (legacyEnvironmentSecret.length >= 32 && legacyEnvironmentSecret !== configuredSecret) {
    candidateSecrets.push(legacyEnvironmentSecret)
  }

  for (const secret of candidateSecrets) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', smtpEncryptionKey(secret), Buffer.from(ivText, 'base64url'))
      decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedText, 'base64url')),
        decipher.final(),
      ]).toString('utf8')
    } catch {
      // 兼容旧版本使用进程环境变量加密的 SMTP 密码。
    }
  }

  throw createError({ statusCode: 503, message: 'SMTP 密码无法解密，请重新保存 SMTP 配置' })
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
  const newPassword = requireGamePassword(newPasswordValue, '新密码')

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
    run('DELETE FROM admin_presence')
    run('DELETE FROM admin_password_history')
    run('DELETE FROM domain_mail_prefix_permissions')
    run('DELETE FROM domain_mail_access_settings')
    run('DELETE FROM domain_mail_sent')
    run('DELETE FROM admin_users')
    const passwordHash = hashAdminPassword(rawPassword)
    const now = Date.now()
    run(
      'INSERT INTO admin_users (username, password_hash, avatar, password_changed_at, is_owner, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
      username, passwordHash, DEFAULT_ADMIN_AVATAR, now, now, now,
    )
    db.exec('COMMIT')
    return entry
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function updateAdminPassword(user: AdminUser, oldPassword: string, newPassword: string): void {
  const row = get('SELECT password_hash FROM admin_users WHERE id = ? AND is_active = 1', user.id)
  const currentHash = String(row?.password_hash ?? '')
  if (!currentHash || !verifyGamePassword(oldPassword, currentHash)) {
    throw createError({ statusCode: 401, statusMessage: '当前密码错误' })
  }
  const password = requireAdminPassword(newPassword, '新密码')
  if (password === oldPassword) {
    throw createError({ statusCode: 400, statusMessage: '新密码不能与当前密码相同' })
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    rotateAdminPassword(user.id, password)
    if (user.isOwner) deleteSetting(ADMIN_PASSWORD_SETTING)
    run('DELETE FROM sessions WHERE user_id = ?', user.id)
    run('DELETE FROM admin_login_takeovers WHERE user_id = ?', user.id)
    run('DELETE FROM admin_presence WHERE user_id = ?', user.id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
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

// ===== 域名邮件（@mcyzw.top 收件） =====

export interface DomainMailAddress {
  name: string
  address: string
}

export interface DomainMailAttachmentMeta {
  id: string
  position: number
  filename: string
  mimeType: string
  disposition: string
  contentId: string
  size: number
  sha256: string
  /** false 表示 Worker 因体积预算只记录了元信息，没有保存二进制，后台不能下载。 */
  stored: boolean
}

export interface DomainMailSummary {
  id: string
  messageId: string
  mailbox: string
  envelopeTo: string
  envelopeFrom: string
  fromAddress: string
  fromName: string
  subject: string
  /** 邮件头 Date；缺失或畸形时为 null，由前端回退显示接收时间。 */
  sentTime: number | null
  receivedTime: number
  rawSize: number
  spf: string
  dkim: string
  dmarc: string
  truncated: boolean
  hasText: boolean
  hasHtml: boolean
  attachmentCount: number
  attachmentBytes: number
  /** 当前后台用户尚未查看这封邮件。 */
  unread: boolean
}

export interface DomainMailDetail extends DomainMailSummary {
  toAddresses: DomainMailAddress[]
  ccAddresses: DomainMailAddress[]
  replyTo: string
  textBody: string
  htmlBody: string
  attachments: DomainMailAttachmentMeta[]
}

export interface DomainMailAccessUser {
  id: number
  username: string
  avatar: string
  fullName: string
  isOwner: boolean
  isActive: boolean
  defaultPrefix: string
  /** 由所有者配置的追加前缀；不含默认用户名邮箱。 */
  prefixes: string[]
  /** 默认用户名邮箱 + 追加前缀（默认项按精确匹配处理）。 */
  effectivePrefixes: string[]
  allMailboxes: boolean
}

const DOMAIN_MAIL_PREFIX_RE = /^[a-z0-9][a-z0-9._+-]{0,63}$/
const DOMAIN_MAIL_PREFIX_LIMIT = 64

function normalizeDomainMailPrefix(value: unknown, index: number): string {
  const prefix = String(value ?? '').trim().toLocaleLowerCase('en-US')
  if (!DOMAIN_MAIL_PREFIX_RE.test(prefix)) {
    throw createError({
      statusCode: 400,
      statusMessage: `第 ${index + 1} 个邮件前缀格式不正确，只能使用字母、数字、点、下划线、加号或连字符`,
    })
  }
  return prefix
}

function requireDomainMailPrefixes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: '邮件前缀列表格式不正确' })
  }
  if (value.length > DOMAIN_MAIL_PREFIX_LIMIT) {
    throw createError({ statusCode: 400, statusMessage: `每位用户最多配置 ${DOMAIN_MAIL_PREFIX_LIMIT} 个邮件前缀` })
  }
  return [...new Set(value.map(normalizeDomainMailPrefix))]
}

function requireDomainMailAllMailboxes(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: '查看全部域名邮件开关参数无效' })
  }
  return value
}

function configuredDomainMailPrefixes(userId: number): string[] {
  return all('SELECT prefix FROM domain_mail_prefix_permissions WHERE user_id = ? ORDER BY prefix', userId)
    .map((row) => String(row.prefix ?? ''))
    .filter(Boolean)
}

function configuredDomainMailAllMailboxes(userId: number): boolean {
  const row = get('SELECT all_mailboxes FROM domain_mail_access_settings WHERE user_id = ?', userId)
  return Number(row?.all_mailboxes ?? 0) === 1
}

function mapDomainMailAccessUser(
  row: Record<string, unknown>,
  configuredPrefixes: string[],
  configuredAllMailboxes = false,
): DomainMailAccessUser {
  const username = String(row.username ?? '')
  const isOwner = Number(row.is_owner ?? 0) === 1
  const defaultPrefix = username.toLocaleLowerCase('en-US')
  const effectivePrefixes = isOwner
    ? []
    : [...new Set([defaultPrefix, ...configuredPrefixes])]
  return {
    id: Number(row.id),
    username,
    avatar: String(row.avatar ?? ''),
    fullName: String(row.full_name ?? ''),
    isOwner,
    isActive: Number(row.is_active ?? 0) === 1,
    defaultPrefix,
    prefixes: configuredPrefixes,
    effectivePrefixes,
    allMailboxes: isOwner || configuredAllMailboxes,
  }
}

export function listDomainMailAccessUsers(): DomainMailAccessUser[] {
  const prefixesByUser = new Map<number, string[]>()
  for (const row of all('SELECT user_id, prefix FROM domain_mail_prefix_permissions ORDER BY user_id, prefix')) {
    const userId = Number(row.user_id)
    const prefixes = prefixesByUser.get(userId) || []
    prefixes.push(String(row.prefix ?? ''))
    prefixesByUser.set(userId, prefixes)
  }
  const allMailboxesByUser = new Map<number, boolean>()
  for (const row of all('SELECT user_id, all_mailboxes FROM domain_mail_access_settings')) {
    allMailboxesByUser.set(Number(row.user_id), Number(row.all_mailboxes ?? 0) === 1)
  }
  return all(`SELECT id, username, avatar, full_name, is_owner, is_active
              FROM admin_users ORDER BY is_owner DESC, username COLLATE NOCASE`)
    .map((row) => mapDomainMailAccessUser(
      row,
      prefixesByUser.get(Number(row.id)) || [],
      allMailboxesByUser.get(Number(row.id)) || false,
    ))
}

export function getDomainMailAccessUser(userId: number): DomainMailAccessUser | undefined {
  const row = get(`SELECT id, username, avatar, full_name, is_owner, is_active
                   FROM admin_users WHERE id = ?`, userId)
  return row
    ? mapDomainMailAccessUser(row, configuredDomainMailPrefixes(userId), configuredDomainMailAllMailboxes(userId))
    : undefined
}

export function updateDomainMailAccessPrefixes(userId: number, value: unknown): DomainMailAccessUser {
  const row = get(`SELECT id, username, avatar, full_name, is_owner, is_active
                   FROM admin_users WHERE id = ?`, userId)
  if (!row) throw createError({ statusCode: 404, statusMessage: '后台用户不存在' })
  if (Number(row.is_owner ?? 0) === 1) {
    throw createError({ statusCode: 400, statusMessage: '初始所有者始终可以查看全部域名邮件' })
  }

  const prefixes = requireDomainMailPrefixes(value)
  const now = Date.now()
  db.exec('BEGIN IMMEDIATE')
  try {
    run('DELETE FROM domain_mail_prefix_permissions WHERE user_id = ?', userId)
    for (const prefix of prefixes) {
      run(`INSERT INTO domain_mail_prefix_permissions (user_id, prefix, created_at, updated_at)
           VALUES (?, ?, ?, ?)`, userId, prefix, now, now)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return mapDomainMailAccessUser(row, prefixes, configuredDomainMailAllMailboxes(userId))
}

export interface DomainMailSentAttachmentMeta {
  filename: string
  mimeType: string
  size: number
  sha256: string
}

export interface DomainMailSentSummary {
  id: string
  senderAddress: string
  senderName: string
  recipient: string
  subject: string
  sentTime: number
  hasText: boolean
  hasHtml: boolean
  attachmentCount: number
  attachmentBytes: number
  textPreview: string
}

export interface DomainMailSentDetail extends DomainMailSentSummary {
  textBody: string
  htmlBody: string
  attachments: DomainMailSentAttachmentMeta[]
}

function parseDomainMailSentAttachments(value: unknown): DomainMailSentAttachmentMeta[] {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      return [{
        filename: String((item as any).filename ?? ''),
        mimeType: String((item as any).mimeType ?? ''),
        size: Number((item as any).size ?? 0),
        sha256: String((item as any).sha256 ?? ''),
      }]
    })
  } catch {
    return []
  }
}

function mapDomainMailSentSummary(row: Record<string, unknown>): DomainMailSentSummary {
  const textBody = String(row.text_body ?? '')
  const htmlBody = String(row.html_body ?? '')
  const attachments = parseDomainMailSentAttachments(row.attachments_json)
  const textLength = row.text_len == null ? textBody.length : Number(row.text_len ?? 0)
  const htmlLength = row.html_len == null ? htmlBody.length : Number(row.html_len ?? 0)
  return {
    id: String(row.id ?? ''),
    senderAddress: String(row.sender_address ?? ''),
    senderName: String(row.sender_name ?? ''),
    recipient: String(row.recipient ?? ''),
    subject: String(row.subject ?? ''),
    sentTime: Number(row.created_at ?? 0),
    hasText: textLength > 0,
    hasHtml: htmlLength > 0,
    attachmentCount: attachments.length,
    attachmentBytes: attachments.reduce((total, attachment) => total + attachment.size, 0),
    textPreview: String(row.text_preview ?? textBody).replace(/\s+/g, ' ').trim().slice(0, 180),
  }
}

function mapDomainMailSentDetail(row: Record<string, unknown>): DomainMailSentDetail {
  const attachments = parseDomainMailSentAttachments(row.attachments_json)
  return {
    ...mapDomainMailSentSummary(row),
    textBody: String(row.text_body ?? ''),
    htmlBody: String(row.html_body ?? ''),
    attachments,
  }
}

function domainMailSentOwner(userId: number): boolean {
  return Number(get('SELECT is_owner FROM admin_users WHERE id = ?', userId)?.is_owner ?? 0) === 1
}

export function listDomainMailSent(userId: number): DomainMailSentSummary[] {
  if (!get('SELECT id FROM admin_users WHERE id = ?', userId)) return []
  const owner = domainMailSentOwner(userId)
  const sql = `SELECT id, sender_address, sender_name, recipient, subject,
                      length(text_body) AS text_len, length(html_body) AS html_len,
                      substr(text_body, 1, 180) AS text_preview,
                      attachments_json, created_at
               FROM domain_mail_sent
               ${owner ? '' : 'WHERE user_id = ?'}
               ORDER BY created_at DESC, id`
  return all(sql, ...(owner ? [] : [userId])).map(mapDomainMailSentSummary)
}

export function getDomainMailSentDetail(id: string, userId: number): DomainMailSentDetail | undefined {
  if (!get('SELECT id FROM admin_users WHERE id = ?', userId)) return undefined
  const owner = domainMailSentOwner(userId)
  const row = get(`SELECT id, sender_address, sender_name, recipient, subject, text_body, html_body,
                         attachments_json, created_at
                  FROM domain_mail_sent
                  WHERE id = ? AND ${owner ? '1 = 1' : 'user_id = ?'}`,
  id,
  ...(owner ? [] : [userId]),
  )
  return row ? mapDomainMailSentDetail(row) : undefined
}

export function recordDomainMailSent(input: {
  userId: number
  senderAddress: string
  senderName: string
  recipient: string
  subject: string
  textBody: string
  htmlBody: string
  attachments: Array<{ filename: string; contentType: string; content: Buffer }>
}): string {
  const id = randomUUID()
  const now = Date.now()
  const attachmentMeta = input.attachments.map((attachment) => ({
    filename: attachment.filename,
    mimeType: attachment.contentType,
    size: attachment.content.length,
    sha256: createHash('sha256').update(attachment.content).digest('hex'),
  }))
  run(`INSERT INTO domain_mail_sent
       (id, user_id, sender_address, sender_name, recipient, subject, text_body, html_body, attachments_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  id,
  input.userId,
  input.senderAddress,
  input.senderName,
  input.recipient,
  input.subject,
  input.textBody,
  input.htmlBody,
  JSON.stringify(attachmentMeta),
  now,
  )
  pruneDomainMailSent()
  return id
}

function pruneDomainMailSent(): void {
  const total = Number(get('SELECT COUNT(*) AS c FROM domain_mail_sent')?.c ?? 0)
  if (total <= DOMAIN_MAIL_SENT_RETENTION_ROWS) return
  run(`DELETE FROM domain_mail_sent
       WHERE id IN (
         SELECT id FROM domain_mail_sent
         ORDER BY created_at DESC, id
         LIMIT -1 OFFSET ${DOMAIN_MAIL_SENT_RETENTION_ROWS}
       )`)
}

interface DomainMailVisibilityFilter {
  clause: string
  params: Array<string | number>
}

function domainMailVisibilityFilter(userId: number): DomainMailVisibilityFilter {
  const user = get('SELECT username, is_owner FROM admin_users WHERE id = ?', userId)
  if (!user) return { clause: '1 = 0', params: [] }
  if (Number(user.is_owner ?? 0) === 1 || configuredDomainMailAllMailboxes(userId)) {
    return { clause: '1 = 1', params: [] }
  }

  const configured = configuredDomainMailPrefixes(userId)
  const defaultPrefix = String(user.username ?? '').toLocaleLowerCase('en-US')
  // 用户名对应的邮箱始终保留精确匹配；所有者配置的项目只作为额外的“开头匹配”范围。
  if (!configured.length) {
    return {
      clause: 'lower(m.mailbox) = ?',
      params: [defaultPrefix],
    }
  }
  const prefixes = configured
  return {
    clause: `(lower(m.mailbox) = ? OR ${prefixes.map(() => 'substr(lower(m.mailbox), 1, ?) = ?').join(' OR ')})`,
    params: [defaultPrefix, ...prefixes.flatMap((prefix) => [prefix.length, prefix])],
  }
}

function canAccessDomainMail(userId: number, mailId: string): boolean {
  const visibility = domainMailVisibilityFilter(userId)
  return Boolean(get(
    `SELECT 1 FROM domain_mails m WHERE m.id = ? AND ${visibility.clause}`,
    mailId,
    ...visibility.params,
  ))
}

// 列表不取正文：单封 HTML 可达 1 MiB，全表拼回去会把响应撑爆。
// 只用 length() 判断有无正文，正文留给详情接口。
const DOMAIN_MAIL_SUMMARY_SQL = `
  SELECT m.id, m.message_id, m.envelope_from, m.envelope_to, m.mailbox,
         m.from_address, m.from_name, m.subject, m.sent_time, m.received_time,
         m.raw_size, m.spf, m.dkim, m.dmarc, m.truncated,
         length(m.text_body) AS text_len, length(m.html_body) AS html_len,
         COUNT(a.id) AS attachment_count,
         COALESCE(SUM(a.size), 0) AS attachment_bytes,
         CASE WHEN EXISTS (
           SELECT 1 FROM domain_mail_reads r WHERE r.user_id = ? AND r.mail_id = m.id
         ) THEN 0 ELSE 1 END AS unread
  FROM domain_mails m
  LEFT JOIN domain_mail_attachments a ON a.mail_id = m.id
`

function mapDomainMailSummary(row: Record<string, unknown>): DomainMailSummary {
  return {
    id: String(row.id),
    messageId: String(row.message_id ?? ''),
    mailbox: String(row.mailbox ?? ''),
    envelopeTo: String(row.envelope_to ?? ''),
    envelopeFrom: String(row.envelope_from ?? ''),
    fromAddress: String(row.from_address ?? ''),
    fromName: String(row.from_name ?? ''),
    subject: String(row.subject ?? ''),
    sentTime: row.sent_time == null ? null : Number(row.sent_time),
    receivedTime: Number(row.received_time ?? 0),
    rawSize: Number(row.raw_size ?? 0),
    spf: String(row.spf ?? ''),
    dkim: String(row.dkim ?? ''),
    dmarc: String(row.dmarc ?? ''),
    truncated: Number(row.truncated ?? 0) === 1,
    hasText: Number(row.text_len ?? 0) > 0,
    hasHtml: Number(row.html_len ?? 0) > 0,
    attachmentCount: Number(row.attachment_count ?? 0),
    attachmentBytes: Number(row.attachment_bytes ?? 0),
    unread: Number(row.unread ?? 0) === 1,
  }
}

export function listDomainMails(userId: number): DomainMailSummary[] {
  const visibility = domainMailVisibilityFilter(userId)
  return all(
    `${DOMAIN_MAIL_SUMMARY_SQL} WHERE ${visibility.clause} GROUP BY m.id ORDER BY m.received_time DESC, m.id`,
    userId,
    ...visibility.params,
  )
    .map(mapDomainMailSummary)
}

export function getDomainMailDetail(id: string, userId: number): DomainMailDetail | undefined {
  const visibility = domainMailVisibilityFilter(userId)
  const row = get(
    `${DOMAIN_MAIL_SUMMARY_SQL} WHERE m.id = ? AND ${visibility.clause} GROUP BY m.id`,
    userId,
    id,
    ...visibility.params,
  )
  if (!row) return undefined
  const bodies = get('SELECT to_addresses, cc_addresses, reply_to, text_body, html_body FROM domain_mails WHERE id = ?', id)
  const attachments = all(`SELECT id, position, filename, mime_type, disposition, content_id, size, sha256,
                                  content IS NOT NULL AS stored
                           FROM domain_mail_attachments WHERE mail_id = ? ORDER BY position`, id)
    .map((item) => ({
      id: String(item.id),
      position: Number(item.position ?? 0),
      filename: String(item.filename ?? ''),
      mimeType: String(item.mime_type ?? ''),
      disposition: String(item.disposition ?? ''),
      contentId: String(item.content_id ?? ''),
      size: Number(item.size ?? 0),
      sha256: String(item.sha256 ?? ''),
      stored: Number(item.stored ?? 0) === 1,
    }))
  return {
    ...mapDomainMailSummary(row),
    toAddresses: parseJsonArray<DomainMailAddress>(bodies?.to_addresses),
    ccAddresses: parseJsonArray<DomainMailAddress>(bodies?.cc_addresses),
    replyTo: String(bodies?.reply_to ?? ''),
    textBody: String(bodies?.text_body ?? ''),
    htmlBody: String(bodies?.html_body ?? ''),
    attachments,
  }
}

export function getUnreadDomainMailCount(userId: number): number {
  const visibility = domainMailVisibilityFilter(userId)
  const row = get(`SELECT COUNT(*) AS count
                   FROM domain_mails m
                   WHERE ${visibility.clause}
                     AND NOT EXISTS (
                     SELECT 1 FROM domain_mail_reads r
                     WHERE r.user_id = ? AND r.mail_id = m.id
                   )`, ...visibility.params, userId)
  return Number(row?.count ?? 0)
}

/** 只有邮件确实存在时才写入记录；重复查看保持第一次阅读时间。 */
export function markDomainMailRead(userId: number, mailId: string): boolean {
  const visibility = domainMailVisibilityFilter(userId)
  const result = run(`INSERT INTO domain_mail_reads (user_id, mail_id, read_at)
                      SELECT ?, m.id, ? FROM domain_mails m
                      WHERE m.id = ? AND ${visibility.clause}
                      ON CONFLICT(user_id, mail_id) DO NOTHING`,
    userId, Date.now(), mailId, ...visibility.params)
  return Number(result.changes) > 0
}

export interface DomainMailReader {
  id: number
  username: string
  avatar: string
  fullName: string
  isOwner: boolean
  isActive: boolean
  readAt: number
}

/** 返回仍存在的后台用户及其首次阅读时间，最近阅读的用户排在前面。 */
export function listDomainMailReaders(mailId: string, userId: number): DomainMailReader[] {
  if (!canAccessDomainMail(userId, mailId)) return []
  return all(`SELECT u.id, u.username, u.avatar, u.full_name, u.is_owner, u.is_active, r.read_at
              FROM domain_mail_reads r
              INNER JOIN admin_users u ON u.id = r.user_id
              WHERE r.mail_id = ?
              ORDER BY r.read_at DESC, u.id`, mailId)
    .map((row) => ({
      id: Number(row.id),
      username: String(row.username ?? ''),
      avatar: String(row.avatar ?? ''),
      fullName: String(row.full_name ?? ''),
      isOwner: Number(row.is_owner ?? 0) === 1,
      isActive: Number(row.is_active ?? 0) === 1,
      readAt: Number(row.read_at ?? 0),
    }))
}

export function getDomainMailAttachment(mailId: string, attachmentId: string, userId: number): {
  filename: string
  mimeType: string
  size: number
  sha256: string
  content: Buffer
} | undefined {
  if (!canAccessDomainMail(userId, mailId)) return undefined
  const row = get(`SELECT filename, mime_type, size, sha256, content
                   FROM domain_mail_attachments WHERE mail_id = ? AND id = ?`, mailId, attachmentId)
  if (!row || row.content == null) return undefined
  return {
    filename: String(row.filename ?? ''),
    mimeType: String(row.mime_type ?? ''),
    size: Number(row.size ?? 0),
    sha256: String(row.sha256 ?? ''),
    content: Buffer.from(row.content as Uint8Array),
  }
}

/**
 * 取一封邮件的全部附件（含二进制），用于重建 .eml 下载。
 * <p>
 * 与 {@link getDomainMailAttachment} 的单个取法分开：这里会把附件内容一次性读进
 * 内存，最多就是入库预算的那 12 MiB，仅供下载这一条路径使用，不要拿它做列表。
 * 没存下内容的附件 {@code content} 为 null，重建时只在头部登记、不放进正文。
 * </p>
 */
export function listDomainMailAttachmentsForEml(mailId: string, userId: number): Array<{
  filename: string
  mimeType: string
  disposition: string
  contentId: string
  size: number
  content: Buffer | null
}> {
  if (!canAccessDomainMail(userId, mailId)) return []
  return all(`SELECT filename, mime_type, disposition, content_id, size, content
              FROM domain_mail_attachments WHERE mail_id = ? ORDER BY position`, mailId)
    .map((row) => ({
      filename: String(row.filename ?? ''),
      mimeType: String(row.mime_type ?? ''),
      disposition: String(row.disposition ?? ''),
      contentId: String(row.content_id ?? ''),
      size: Number(row.size ?? 0),
      content: row.content == null ? null : Buffer.from(row.content as Uint8Array),
    }))
}

/**
 * 落库一封 Worker 投递的收件。
 * <p>
 * Message-ID 命中已有记录时不再写入，直接返回原有 id 并置 {@code duplicate}：
 * Worker 在网络抖动后会重试同一封信，这里必须幂等，否则后台会看到重复邮件。
 * </p>
 */
export function insertDomainMail(payload: InboundMailPayload): { id: string; duplicate: boolean } {
  if (payload.messageId) {
    const existing = get('SELECT id FROM domain_mails WHERE message_id = ?', payload.messageId)
    if (existing) return { id: String(existing.id), duplicate: true }
  }

  const id = randomUUID()
  const now = Date.now()
  db.exec('BEGIN IMMEDIATE')
  try {
    // 事务内复检：并发重试可能在上面的查询之后插入同一封信。
    if (payload.messageId) {
      const existing = get('SELECT id FROM domain_mails WHERE message_id = ?', payload.messageId)
      if (existing) {
        db.exec('COMMIT')
        return { id: String(existing.id), duplicate: true }
      }
    }
    run(`INSERT INTO domain_mails (
           id, message_id, envelope_from, envelope_to, mailbox,
           from_address, from_name, to_addresses, cc_addresses, reply_to,
           subject, sent_time, received_time, text_body, html_body,
           raw_size, spf, dkim, dmarc, truncated, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, payload.messageId, payload.envelopeFrom, payload.envelopeTo, payload.mailbox,
      payload.fromAddress, payload.fromName, JSON.stringify(payload.toAddresses),
      JSON.stringify(payload.ccAddresses), payload.replyTo,
      payload.subject, payload.sentTime, payload.receivedTime, payload.textBody, payload.htmlBody,
      payload.rawSize, payload.spf, payload.dkim, payload.dmarc, payload.truncated ? 1 : 0, now)

    payload.attachments.forEach((attachment, position) => {
      run(`INSERT INTO domain_mail_attachments (
             id, mail_id, position, filename, mime_type, disposition,
             content_id, size, sha256, content, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(), id, position, attachment.filename, attachment.mimeType, attachment.disposition,
        attachment.contentId, attachment.size,
        attachment.content ? createHash('sha256').update(attachment.content).digest('hex') : '',
        attachment.content, now)
    })

    pruneDomainMails()
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { id, duplicate: false }
}

/** 超出保留上限时淘汰最旧的收件，附件随之删除。 */
function pruneDomainMails(): void {
  // 先用 COUNT(*) 挡住常态：没超上限就不必为每封新信都做一次全表排序。
  const total = Number(get('SELECT COUNT(*) AS c FROM domain_mails')?.c ?? 0)
  if (total <= DOMAIN_MAIL_RETENTION_ROWS) return

  const stale = all(`SELECT id FROM domain_mails
                     ORDER BY received_time DESC, id
                     LIMIT -1 OFFSET ${DOMAIN_MAIL_RETENTION_ROWS}`)
  for (const row of stale) {
    const staleId = String(row.id)
    run('DELETE FROM domain_mail_reads WHERE mail_id = ?', staleId)
    run('DELETE FROM domain_mail_attachments WHERE mail_id = ?', staleId)
    run('DELETE FROM domain_mails WHERE id = ?', staleId)
  }
}

export function deleteDomainMail(id: string, userId: number): boolean {
  if (!canAccessDomainMail(userId, id)) return false
  db.exec('BEGIN IMMEDIATE')
  try {
    run('DELETE FROM domain_mail_reads WHERE mail_id = ?', id)
    run('DELETE FROM domain_mail_attachments WHERE mail_id = ?', id)
    const result = run('DELETE FROM domain_mails WHERE id = ?', id)
    db.exec('COMMIT')
    return Number(result.changes) > 0
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
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
  if (getSetting('downloads.launchers_removed') !== 'true') {
    run("DELETE FROM downloads WHERE type = '启动器'")
    deleteSetting('downloads.default_launchers_seeded')
    setSetting('downloads.launchers_removed', 'true')
  }
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
        'INSERT INTO admin_users (username, password_hash, avatar, password_changed_at, is_owner, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)',
        configuredUsername, passwordHash, DEFAULT_ADMIN_AVATAR, now, now, now,
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
