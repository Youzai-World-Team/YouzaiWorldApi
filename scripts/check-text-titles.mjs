// 执行真实称号 SQL、升级和业务函数；只使用内存库，不读取运行期数据。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { DatabaseSync } from 'node:sqlite'

const root = new URL('../', import.meta.url)
const read = file => readFileSync(new URL(file, root), 'utf8').replace(/\r\n/g, '\n')
const source = read('server/utils/db.ts')
const schema = source.slice(source.indexOf('  CREATE TABLE IF NOT EXISTS game_titles'), source.indexOf('  CREATE TABLE IF NOT EXISTS game_sessions'))
const setup = source.slice(source.indexOf('// 文字称号升级只清理旧图片字段'), source.indexOf('const adminUserColumns'))
const logic = source.slice(source.indexOf('export interface GameTitle {'), source.indexOf('export function createGameSession('))
assert.ok(schema && setup && logic, '无法定位称号实现')
const js = stripTypeScriptTypes(`${setup}\n${logic}`.replace(/\bexport /g, ''))
const accountSchema = `CREATE TABLE game_accounts (
  username TEXT NOT NULL, username_lower TEXT PRIMARY KEY, password TEXT NOT NULL DEFAULT '', uuid TEXT
);`
const createError = options => Object.assign(new Error(options.statusMessage), options)
const load = db => {
  db.exec(schema)
  const get = (sql, ...params) => db.prepare(sql).get(...params)
  const all = (sql, ...params) => db.prepare(sql).all(...params)
  const run = (sql, ...params) => db.prepare(sql).run(...params)
  const mapAccount = row => row && { username: row.username, usernameLower: row.username_lower, uuid: row.uuid }
  const getGameAccount = username => mapAccount(get('SELECT * FROM game_accounts WHERE username_lower = ?', username.trim().toLowerCase()))
  const listGameAccounts = () => all('SELECT * FROM game_accounts').map(mapAccount)
  return new Function('db', 'createError', 'get', 'all', 'run', 'getGameAccount', 'listGameAccounts', `${js}\nreturn {
    getGameTitle, saveGameTitle, listGameTitles, gameTitleWire, getGamePlayerTitleSnapshot,
    syncPermissionGameTitles, setGamePlayerEquippedTitle, grantGameTitleManually, revokeEditableGameTitleGrants
  }`)(db, createError, get, all, run, getGameAccount, listGameAccounts)
}
const rows = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all()
const columnNames = db => db.prepare('PRAGMA table_info(game_titles)').all().map(row => row.name)
const legacyColumns = ['render_type', 'texture_key', 'font_id', 'glyph']
const addAccount = (db, username, password = 'registered') => db.prepare(
  'INSERT INTO game_accounts (username, username_lower, password) VALUES (?, ?, ?)'
).run(username, username.toLowerCase(), password)
const reject = (fn, status) => assert.throws(fn, error => error.statusCode === status)
let checks = 0
const check = (label, fn) => { fn(); checks++; process.stdout.write(`✓ ${label}\n`) }

const fresh = new DatabaseSync(':memory:')
fresh.exec(accountSchema)
const api = load(fresh)
check('新目录与同步响应只有文字、样式和管理字段', () => {
  assert.equal(api.listGameTitles().length, 4)
  assert.ok(legacyColumns.every(column => !columnNames(fresh).includes(column)))
  for (const title of api.listGameTitles()) {
    assert.ok(title.textContent)
    const wire = api.gameTitleWire(title)
    assert.ok(legacyColumns.every(column => !(column in wire)))
  }
})
check('空文字使用名称回退，并保存颜色、粗体和斜体', () => {
  const title = api.saveGameTitle({ id: 'traveler', displayName: '远行者', textContent: '   ', textColor: '#112233', bold: true, italic: true })
  assert.equal(title.textContent, '远行者')
  assert.deepEqual([title.textColor, title.bold, title.italic], ['#112233', true, true])
})
addAccount(fresh, 'NewPlayer')
check('首次注册授予并佩戴默认文字称号', () => {
  const state = api.getGamePlayerTitleSnapshot('NewPlayer')
  assert.equal(state.equippedTitleId, 'newbie_plea')
  assert.deepEqual(state.ownedTitleIds, ['newbie_plea'])
  assert.equal(state.grants[0].source, 'registration')
})
check('卸下只清除选择，保留所有权；权限与普通账户更新不会重新佩戴', () => {
  assert.equal(api.setGamePlayerEquippedTitle('NewPlayer', null).equippedTitleId, null)
  api.syncPermissionGameTitles([{ username: 'NewPlayer', titleIds: ['admin_senior'] }])
  fresh.prepare('UPDATE game_accounts SET password = ? WHERE username_lower = ?').run('updated', 'newplayer')
  const state = api.getGamePlayerTitleSnapshot('NewPlayer')
  assert.equal(state.equippedTitleId, null)
  assert.ok(state.ownedTitleIds.includes('newbie_plea'))
  assert.ok(state.ownedTitleIds.includes('admin_senior'))
})
check('空字符串也可卸下，未拥有的称号不能佩戴', () => {
  api.setGamePlayerEquippedTitle('NewPlayer', 'admin_senior')
  assert.equal(api.setGamePlayerEquippedTitle('NewPlayer', '').equippedTitleId, null)
  reject(() => api.setGamePlayerEquippedTitle('NewPlayer', 'traveler'), 403)
})
check('停用已佩戴称号时清除选择，保留授权并阻止再次佩戴', () => {
  api.grantGameTitleManually('NewPlayer', 'traveler', 'tester')
  api.setGamePlayerEquippedTitle('NewPlayer', 'traveler')
  api.saveGameTitle({ id: 'traveler', displayName: '远行者', enabled: false })
  const state = api.getGamePlayerTitleSnapshot('NewPlayer')
  assert.equal(state.equippedTitleId, null)
  assert.ok(!state.ownedTitleIds.includes('traveler'))
  assert.ok(state.grants.some(grant => grant.titleId === 'traveler'))
  reject(() => api.setGamePlayerEquippedTitle('NewPlayer', 'traveler'), 403)
})
check('手动回收不会删除权限来源，也不会恢复不佩戴状态', () => {
  api.grantGameTitleManually('NewPlayer', 'admin_senior', 'tester')
  const state = api.revokeEditableGameTitleGrants('NewPlayer', 'admin_senior')
  assert.deepEqual(state.grants.filter(grant => grant.titleId === 'admin_senior').map(grant => grant.source), ['permission'])
  assert.equal(state.equippedTitleId, null)
})
check('回收注册称号后，普通账户更新不会补发', () => {
  api.revokeEditableGameTitleGrants('NewPlayer', 'newbie_plea')
  fresh.prepare('UPDATE game_accounts SET password = ? WHERE username_lower = ?').run('updated-again', 'newplayer')
  assert.ok(!api.getGamePlayerTitleSnapshot('NewPlayer').ownedTitleIds.includes('newbie_plea'))
})

function legacyDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec(accountSchema)
  db.exec(`CREATE TABLE game_titles (
    id TEXT PRIMARY KEY, display_name TEXT NOT NULL, render_type TEXT NOT NULL,
    text_content TEXT NOT NULL DEFAULT '', text_color TEXT NOT NULL DEFAULT '#FFFFFF',
    bold INTEGER NOT NULL DEFAULT 0, italic INTEGER NOT NULL DEFAULT 0,
    texture_key TEXT NOT NULL DEFAULT '', font_id TEXT NOT NULL DEFAULT 'youzaiworldcore:title', glyph TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, system_managed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );`)
  db.exec(schema)
  const insert = db.prepare('INSERT INTO game_titles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  insert.run('custom_badge', '远行者', 'text_texture', '历练者', '#112233', 1, 1, 'custom', 'custom:font', '\uE104', 1, 5, 0, 11, 12)
  insert.run('newbie_plea', '自定义萌新', 'texture', '', '#55FF55', 0, 0, 'new', 'youzaiworldcore:title', '\uE100', 1, 10, 1, 13, 14)
  addAccount(db, 'LegacyWearer')
  addAccount(db, 'LegacyNone')
  db.exec(`INSERT INTO game_player_title_grants VALUES ('legacywearer', 'custom_badge', 'manual', 'admin', 'tester', 100);
    INSERT INTO game_player_title_grants VALUES ('legacynone', 'custom_badge', 'manual', 'admin', 'tester', 101);
    INSERT INTO game_player_title_selection VALUES ('legacywearer', 'custom_badge', 102);`)
  return db
}
const old = legacyDatabase()
const oldGrants = rows(old, 'game_player_title_grants')
const oldSelections = rows(old, 'game_player_title_selection')
const upgraded = load(old)
check('旧贴图目录转成文字，保留原有文字、样式、名称及时间', () => {
  assert.ok(legacyColumns.every(column => !columnNames(old).includes(column)))
  const custom = upgraded.getGameTitle('custom_badge')
  assert.deepEqual([custom.displayName, custom.textContent, custom.textColor, custom.bold, custom.italic, custom.createdAt, custom.updatedAt],
    ['远行者', '历练者', '#112233', true, true, 11, 12])
  assert.equal(upgraded.getGameTitle('newbie_plea').textContent, '自定义萌新')
})
check('升级完整保留授权和佩戴记录，既有不佩戴选择保持为空', () => {
  assert.deepEqual(rows(old, 'game_player_title_grants'), oldGrants)
  assert.deepEqual(rows(old, 'game_player_title_selection'), oldSelections)
  assert.equal(upgraded.getGamePlayerTitleSnapshot('LegacyWearer').equippedTitleId, 'custom_badge')
  assert.equal(upgraded.getGamePlayerTitleSnapshot('LegacyNone').equippedTitleId, null)
})
check('重复启动幂等，不回填老账户也不重置佩戴选择', () => {
  const reloaded = load(old)
  assert.deepEqual(rows(old, 'game_player_title_grants'), oldGrants)
  assert.deepEqual(rows(old, 'game_player_title_selection'), oldSelections)
  assert.ok(!reloaded.getGamePlayerTitleSnapshot('LegacyNone').ownedTitleIds.includes('newbie_plea'))
})
check('图片字段清理失败时，文字和表结构一同回滚', () => {
  const db = legacyDatabase()
  const columnsBefore = columnNames(db)
  const titlesBefore = rows(db, 'game_titles')
  const proxy = {
    prepare: db.prepare.bind(db),
    exec(sql) {
      if (sql.includes('DROP COLUMN font_id')) throw new Error('模拟升级失败')
      return db.exec(sql)
    },
  }
  assert.throws(() => load(proxy), /模拟升级失败/)
  assert.deepEqual(columnNames(db), columnsBefore)
  assert.deepEqual(rows(db, 'game_titles'), titlesBefore)
  db.close()
})

const page = read('app/pages/game-titles.vue')
const formatting = page.slice(page.indexOf('function titleLabel('), page.indexOf('async function loadOverview('))
const formatters = new Function('titleMap', `${stripTypeScriptTypes(formatting)}\nreturn {titleLabel, equippedName, ownedTitleLabel};`)(
  { value: new Map(api.listGameTitles().map(title => [title.id, api.gameTitleWire(title)])) }
)
check('后台文字预览使用花括号，不佩戴时显示明确的空选择', () => {
  assert.equal(formatters.titleLabel({ text_content: '萌新求饶', display_name: '后台名称' }), '{萌新求饶}')
  assert.equal(formatters.titleLabel({ text_content: '', display_name: '远行者' }), '{远行者}')
  assert.equal(formatters.titleLabel({ text_content: '', display_name: '' }), '')
  assert.equal(formatters.equippedName({ equipped_title_id: null }), '不佩戴称号')
  assert.equal(formatters.ownedTitleLabel('unknown_title'), '{unknown_title}')
})
fresh.close()
old.close()
process.stdout.write(`文字称号回归通过：${checks} 组检查。\n`)
