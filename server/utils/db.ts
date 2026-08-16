import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { getCookie, getHeader, createError, type H3Event } from 'h3'

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
    time INTEGER
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
`)

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

export function hasSession(token: string): boolean {
  return !!get('SELECT token FROM sessions WHERE token = ?', token)
}

export function createSession(token: string) {
  run('INSERT INTO sessions (token, time) VALUES (?, ?)', token, Date.now())
}

export function deleteSession(token: string) {
  run('DELETE FROM sessions WHERE token = ?', token)
}

export function requireAuth(event: H3Event): string {
  const cookie = getCookie(event, 'youzai_token')
  const header = getHeader(event, 'authorization')?.replace('Bearer ', '')
  const token = cookie || header
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: '未登录' })
  }
  if (!hasSession(token)) {
    throw createError({ statusCode: 401, statusMessage: '会话已失效' })
  }
  return token
}

export function pushLogin(ip: string, time: number) {
  run('INSERT INTO login_history (ip, time) VALUES (?, ?)', ip, time)
  run('DELETE FROM login_history WHERE id NOT IN (SELECT id FROM login_history ORDER BY id DESC LIMIT 10)')
}

export function listLogins(): { ip: string; time: number }[] {
  return all('SELECT ip, time FROM login_history ORDER BY id DESC') as { ip: string; time: number }[]
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
  if (getSetting('password') === undefined) {
    const config = await readJsonFile<{ password?: string; entry?: string }>('config.json')
    setSetting('password', config?.password || '123456')
    setSetting('entry', config?.entry || '123456')
  }

  if (count('sessions') === 0) {
    const sessions = await readJsonFile<Record<string, number>>('sessions.json')
    if (sessions) {
      for (const [token, time] of Object.entries(sessions)) {
        run('INSERT INTO sessions (token, time) VALUES (?, ?)', token, time)
      }
    }
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
