import { DatabaseSync } from 'node:sqlite'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto'
import { mkdirSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { getCookie, getHeader, createError, type H3Event } from 'h3'
import { offlinePlayerUuid, requireEmailAddress } from './game-input'

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
    is_owner INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
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
  CREATE TABLE IF NOT EXISTS game_cosmetics (
    uuid TEXT NOT NULL,
    slot TEXT NOT NULL,
    data BLOB NOT NULL,
    sha256 TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (uuid, slot)
  );
  CREATE TABLE IF NOT EXISTS api_request_nonces (
    nonce TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_login_rate_limits (
    rate_key TEXT PRIMARY KEY,
    window_started INTEGER NOT NULL,
    attempts INTEGER NOT NULL
  );
`)

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

const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const GAME_REQUEST_MAX_SKEW_SECONDS = 300
const GAME_REQUEST_NONCE_TTL_MS = 10 * 60 * 1000
const GAME_REGISTRATION_SESSION_TTL_MS = 15 * 60 * 1000
const GAME_EMAIL_CODE_TTL_MS = 10 * 60 * 1000
const GAME_EMAIL_RESEND_DELAY_MS = 60 * 1000
const GAME_EMAIL_MAX_ATTEMPTS = 5
const GAME_API_KEY_ENV = 'YZWC_GAME_API_KEY'
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
const TURNSTILE_SITE_KEY_SETTING = 'turnstile.site_key'
const TURNSTILE_SECRET_SETTING = 'turnstile.secret'
const TURNSTILE_HOSTNAMES_SETTING = 'turnstile.hostnames'
const TURNSTILE_SITE_KEY_ENV = 'NUXT_PUBLIC_TURNSTILE_SITE_KEY'
const TURNSTILE_SECRET_ENV = 'TURNSTILE_SECRET'
const TURNSTILE_HOSTNAMES_ENV = 'TURNSTILE_HOSTNAMES'
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000
const LOGIN_RATE_MAX_ATTEMPTS = 5
const ADMIN_ENTRY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{11,63}$/
const RESERVED_ADMIN_ENTRIES = new Set([
  'login', 'account', 'activity', 'donors', 'bans', 'updates', 'game-accounts',
  'admin-users', 'audit-logs', 'api', '_nuxt', '_ipx', 'favicon', '__nuxt_error',
])

export const ADMIN_COOKIE_NAME = '__Host-yzwc_admin'
const ADMIN_USER_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/

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

export function setTurnstileConfig(siteKeyValue: unknown, secretValue: unknown, hostnamesValue: unknown): void {
  const siteKey = requireTurnstileValue(siteKeyValue, 'Turnstile 站点密钥', 256)
  const secret = requireTurnstileValue(secretValue, 'Turnstile 服务端密钥', 512)
  const hostnames = requireTurnstileHostnames(hostnamesValue)
  setSetting(TURNSTILE_SITE_KEY_SETTING, siteKey)
  setSetting(TURNSTILE_SECRET_SETTING, secret)
  setSetting(TURNSTILE_HOSTNAMES_SETTING, hostnames)
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface AdminUser {
  id: number
  username: string
  isOwner: boolean
  isActive: boolean
  createdAt: number
}

function mapAdminUser(row: Record<string, unknown>): AdminUser {
  return {
    id: Number(row.id),
    username: String(row.username ?? ''),
    isOwner: Number(row.is_owner ?? 0) === 1,
    isActive: Number(row.is_active ?? 0) === 1,
    createdAt: Number(row.created_at ?? 0),
  }
}

function getAdminUserById(id: number): AdminUser | undefined {
  const row = get('SELECT id, username, is_owner, is_active, created_at FROM admin_users WHERE id = ?', id)
  return row ? mapAdminUser(row) : undefined
}

export function listAdminUsers(): AdminUser[] {
  return all('SELECT id, username, is_owner, is_active, created_at FROM admin_users ORDER BY is_owner DESC, username COLLATE NOCASE')
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

export function createAdminUser(usernameValue: unknown, passwordValue: unknown, isOwner = false): AdminUser {
  const username = requireAdminUsername(usernameValue)
  const password = requireAdminPassword(passwordValue)
  const now = Date.now()
  try {
    const result = run(
      'INSERT INTO admin_users (username, password_hash, is_owner, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      username, hashAdminPassword(password), isOwner ? 1 : 0, now, now,
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
  run('DELETE FROM admin_users WHERE id = ?', userId)
}

export function requireOwner(event: H3Event): AdminUser {
  const user = requireAuth(event)
  if (!user.isOwner) throw createError({ statusCode: 403, statusMessage: '只有所有者可以管理后台用户' })
  return user
}

export function getAdminUserForLogin(usernameValue: unknown, password: string): AdminUser | undefined {
  const username = String(usernameValue ?? '').trim()
  const row = get('SELECT id, username, password_hash, is_owner, is_active, created_at FROM admin_users WHERE username = ?', username)
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
  const expected = requireSecret(GAME_API_KEY_ENV, 32)
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
  requireSecret(GAME_API_KEY_ENV, 32)
  if (isAdminInitialized()) getAdminEntry()
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
    throw createError({ statusCode: 401, statusMessage: '游戏会话已失效' })
  }
  const expiresAt = row.expires_at == null ? null : Number(row.expires_at)
  if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    run('DELETE FROM game_sessions WHERE token = ?', digest)
    throw createError({ statusCode: 401, statusMessage: '游戏会话已过期' })
  }
  const account = getGameAccount(String(row.username_lower))
  if (!account) throw createError({ statusCode: 401, statusMessage: '账户不存在' })
  return account
}

export function deleteGameSession(token: string) {
  run('DELETE FROM game_sessions WHERE token = ?', tokenDigest(token))
}

export function deleteGameSessionsForUser(username: string) {
  run('DELETE FROM game_sessions WHERE username_lower = ?', username.trim().toLocaleLowerCase('en-US'))
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
  }
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

export function issueGameRegistrationEmailCode(
  sessionIdValue: unknown,
  emailValue: unknown,
): { code: string; email: string; username: string; expiresInSeconds: number; resendAfterSeconds: number } {
  const { identity, session } = getGameRegistrationSession(sessionIdValue)
  const email = requireEmailAddress(emailValue)
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
      throw createError({ statusCode: 409, statusMessage: '账户已注册' })
    }
    upsertGameAccount(account)
    run('DELETE FROM game_registration_sessions WHERE id_hash = ?', identity.hash)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { account, startSession: session.startSession }
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
): string {
  const username = requireAdminUsername(usernameValue)
  const rawPassword = requireAdminPassword(password, '后台密码')
  const entry = requireValidAdminEntry(entryValue)

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
    run('DELETE FROM sessions')
    run('DELETE FROM admin_users')
    const passwordHash = hashAdminPassword(rawPassword)
    run(
      'INSERT INTO admin_users (username, password_hash, is_owner, is_active, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)',
      username, passwordHash, Date.now(), Date.now(),
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
        'INSERT INTO admin_users (username, password_hash, is_owner, is_active, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)',
        configuredUsername, passwordHash, now, now,
      )
      // 多用户认证已迁移到 admin_users，删除旧设置中的历史哈希，避免保留第二个认证源。
      deleteSetting(ADMIN_PASSWORD_SETTING)
    }
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
