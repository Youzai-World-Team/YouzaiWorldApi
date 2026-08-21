import { DatabaseSync } from 'node:sqlite'
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { getCookie, getHeader, createError, type H3Event } from 'h3'
import { offlinePlayerUuid } from './game-input'

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
    time INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT,
    time INTEGER,
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

const loginHistoryColumns = db.prepare('PRAGMA table_info(login_history)').all() as { name?: string }[]
for (const column of ['browser', 'os', 'device']) {
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

const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const GAME_REQUEST_MAX_SKEW_SECONDS = 300
const GAME_REQUEST_NONCE_TTL_MS = 10 * 60 * 1000
const GAME_API_KEY_ENV = 'YZWC_GAME_API_KEY'
const ADMIN_PASSWORD_ENV = 'YZWC_ADMIN_PASSWORD'
const ADMIN_ENTRY_ENV = 'YZWC_ADMIN_ENTRY'
const ADMIN_PASSWORD_SETTING = 'admin.password_hash'
const ADMIN_ENTRY_SETTING = 'entry'
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000
const LOGIN_RATE_MAX_ATTEMPTS = 5
const ADMIN_ENTRY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{11,63}$/
const RESERVED_ADMIN_ENTRIES = new Set([
  'login', 'account', 'activity', 'donors', 'bans', 'updates', 'game-accounts',
  'api', '_nuxt', '_ipx', 'favicon', '__nuxt_error',
])

export const ADMIN_COOKIE_NAME = '__Host-yzwc_admin'

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

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function hasSession(token: string): boolean {
  const digest = tokenDigest(token)
  const row = get('SELECT time FROM sessions WHERE token = ?', digest)
  if (!row) return false
  const createdAt = Number(row.time)
  if (!Number.isFinite(createdAt) || createdAt + ADMIN_SESSION_TTL_MS <= Date.now()) {
    deleteSession(token)
    return false
  }
  return true
}

export function createSession(token: string) {
  run('INSERT INTO sessions (token, time) VALUES (?, ?)', tokenDigest(token), Date.now())
}

export function deleteSession(token: string) {
  run('DELETE FROM sessions WHERE token = ?', tokenDigest(token))
}

export function requireAuth(event: H3Event): string {
  const cookie = getCookie(event, ADMIN_COOKIE_NAME)
  const header = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')
  const token = cookie || header
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: '未登录' })
  }
  if (!hasSession(token)) {
    throw createError({ statusCode: 401, statusMessage: '会话已失效' })
  }
  return token
}

interface LoginClientInfo {
  browser: string
  os: string
  device: string
}

export function pushLogin(ip: string, time: number, client: LoginClientInfo) {
  run(
    'INSERT INTO login_history (ip, time, browser, os, device) VALUES (?, ?, ?, ?, ?)',
    ip, time, client.browser, client.os, client.device,
  )
  run('DELETE FROM login_history WHERE id NOT IN (SELECT id FROM login_history ORDER BY id DESC LIMIT 10)')
}

export function listLogins(): Array<{ ip: string; time: number; browser: string; os: string; device: string }> {
  return all('SELECT ip, time, browser, os, device FROM login_history ORDER BY id DESC') as Array<{
    ip: string
    time: number
    browser: string
    os: string
    device: string
  }>
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
    throw createError({ statusCode: 503, statusMessage: `${name} 未配置或长度不足` })
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
    (username_lower, username, uuid, password, last_ip, last_login_ip, last_authenticated_date, registration_date,
     login_tries, last_kicked_date, last_position, in_place_respawn_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(username_lower) DO UPDATE SET
      username = excluded.username, uuid = COALESCE(excluded.uuid, game_accounts.uuid),
      password = CASE WHEN excluded.password = '' THEN game_accounts.password ELSE excluded.password END,
      last_ip = excluded.last_ip,
      last_login_ip = excluded.last_login_ip,
      last_authenticated_date = excluded.last_authenticated_date,
      registration_date = excluded.registration_date, login_tries = excluded.login_tries,
      last_kicked_date = excluded.last_kicked_date, last_position = excluded.last_position,
      in_place_respawn_count = excluded.in_place_respawn_count, updated_at = excluded.updated_at`,
    account.usernameLower, account.username, account.uuid, account.password, account.lastIp,
    account.lastLoginIp, account.lastAuthenticatedDate, account.registrationDate, account.loginTries, account.lastKickedDate,
    account.lastPosition, account.inPlaceRespawnCount, Date.now())
}

export function deleteGameAccount(username: string): boolean {
  const key = username.trim().toLocaleLowerCase('en-US')
  const result = run('DELETE FROM game_accounts WHERE username_lower = ?', key)
  run('DELETE FROM game_sessions WHERE username_lower = ?', key)
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

export interface GameAccountSettings {
  loginCooldown: number
}

export function getGameAccountSettings(): GameAccountSettings {
  const loginCooldown = Number(getSetting('game_account.login_cooldown') ?? 300)
  return {
    loginCooldown: Number.isFinite(loginCooldown)
      ? Math.min(86_400, Math.max(-1, Math.trunc(loginCooldown)))
      : 300,
  }
}

export function setGameAccountSettings(settings: Partial<GameAccountSettings>): GameAccountSettings {
  const current = getGameAccountSettings()
  const loginCooldown = settings.loginCooldown === undefined
    ? current.loginCooldown
    : Math.min(86_400, Math.max(-1, Math.trunc(Number(settings.loginCooldown) || 0)))
  setSetting('game_account.login_cooldown', String(loginCooldown))
  return { loginCooldown }
}

function hashAdminPassword(password: string): string {
  const iterations = 600_000
  const salt = randomBytes(16)
  const digest = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  return `PBKDF2:${iterations}:${salt.toString('base64')}:${digest.toString('base64')}`
}

export function isAdminInitialized(): boolean {
  const passwordHash = getSetting(ADMIN_PASSWORD_SETTING) || ''
  const entry = getSetting(ADMIN_ENTRY_SETTING)?.trim() || ''
  return passwordHash.startsWith('PBKDF2:') && ADMIN_ENTRY_RE.test(entry)
    && !RESERVED_ADMIN_ENTRIES.has(entry.toLowerCase())
}

export function requireValidAdminEntry(value: unknown): string {
  const entry = String(value ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (!ADMIN_ENTRY_RE.test(entry) || RESERVED_ADMIN_ENTRIES.has(entry.toLowerCase())) {
    throw createError({ statusCode: 400, statusMessage: '入口需要为 12 至 64 位字母、数字、下划线或连字符，且不能与现有页面冲突' })
  }
  return entry
}

export function initializeAdmin(password: unknown, entryValue: unknown): string {
  const rawPassword = String(password ?? '')
  if (rawPassword.length < 12 || rawPassword.length > 128) {
    throw createError({ statusCode: 400, statusMessage: '后台密码长度需要为 12 至 128 位' })
  }
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
    const passwordHash = hashAdminPassword(rawPassword)
    setSetting(ADMIN_PASSWORD_SETTING, passwordHash)
    setSetting(ADMIN_ENTRY_SETTING, entry)
    run('DELETE FROM sessions')
    db.exec('COMMIT')
    return entry
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function verifyAdminPassword(password: string): boolean {
  const storedHash = getSetting(ADMIN_PASSWORD_SETTING)
  return Boolean(storedHash && verifyGamePassword(password, storedHash))
}

export function updateAdminPassword(oldPassword: string, newPassword: string): void {
  if (!verifyAdminPassword(oldPassword)) {
    throw createError({ statusCode: 401, statusMessage: '当前密码错误' })
  }
  if (newPassword.length < 12 || newPassword.length > 128) {
    throw createError({ statusCode: 400, statusMessage: '新密码长度需要为 12 至 128 位' })
  }
  setSetting(ADMIN_PASSWORD_SETTING, hashAdminPassword(newPassword))
  run('DELETE FROM sessions')
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

  if (count('sessions') === 0) {
    const sessions = await readJsonFile<Record<string, number>>('sessions.json')
    if (sessions) {
      for (const [token, time] of Object.entries(sessions)) {
        run('INSERT INTO sessions (token, time) VALUES (?, ?)', token, time)
      }
    }
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
