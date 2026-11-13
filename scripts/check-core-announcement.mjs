// 校验实际公告业务函数与接口，数据库位于临时目录，不启动 Nuxt 或访问运行期数据。
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = new URL('../', import.meta.url)
const read = (file) => readFileSync(new URL(file, root), 'utf8')
const compile = (source) => stripTypeScriptTypes(source.replace(/\bexport /g, ''))
const shared = compile(read('shared/core-announcement.ts'))
const dbSource = read('server/utils/db.ts')
const business = dbSource.slice(dbSource.indexOf('export function getSetting('), dbSource.indexOf('export interface StatusHistorySampleInput'))
const permission = dbSource.slice(dbSource.indexOf('export function requirePagePermission('), dbSource.indexOf('export function adminFeatureAllows('))
const createError = (options) => Object.assign(new Error(options.statusMessage), options)
const requireAuth = (event) => {
  if (!event.user) throw createError({ statusCode: 401, statusMessage: '未登录' })
  return event.user
}
const pagePermissions = new Function(`${compile(read('shared/admin-page-permissions.ts'))}; return { permissionAllows, adminPageKeyForPath, ADMIN_NAVIGATION_ORDER }`)()
const apiPermissions = new Function(`${compile(read('shared/admin-api-permissions.ts'))}; return { pageKeyForApi }`)()
const directory = mkdtempSync(join(tmpdir(), 'yzwc-announcement-'))
let db
let checks = 0
const check = async (name, run) => { await run(); checks++; process.stdout.write(`✓ ${name}\n`) }
const reject = (run, status = 400) => assert.throws(run, (error) => error.statusCode === status)
const loadBusiness = () => new Function('db', 'createError', 'requireAuth', 'permissionAllows', `
  const get = (sql, ...params) => db.prepare(sql).get(...params)
  const run = (sql, ...params) => db.prepare(sql).run(...params)
  ${shared}
  ${compile(business)}
  ${compile(permission)}
  return {getCoreAnnouncement, setCoreAnnouncement, getPublicCoreAnnouncement, requirePagePermission}
`)(db, createError, requireAuth, pagePermissions.permissionAllows)
const route = (file, api) => new Function('api', 'defineEventHandler', 'readBody', 'setHeader', `
  const {getCoreAnnouncement, setCoreAnnouncement, getPublicCoreAnnouncement, requirePagePermission} = api
  ${stripTypeScriptTypes(read(file).replace(/^import[^\n]*\n/gm, '')).replace('export default', 'return')}
`)(api, (handler) => handler, async (event) => event.body, (event, key, value) => { event.headers[key] = value })

try {
  db = new DatabaseSync(join(directory, 'test.db'))
  db.exec(dbSource.match(/CREATE TABLE IF NOT EXISTS settings\s*\([\s\S]*?\);/)[0])
  let api = loadBusiness()
  const draft = { enabled: true, title: '  维护公告  ', subtitle: '今晚维护', body: ['第一段', '', '  第二段保留空格  ', '<b>按文字显示</b>'] }
  await check('首次访问保持内置公告，不公开预填草稿', () => {
    assert.equal(api.getCoreAnnouncement().enabled, false)
    assert.deepEqual(api.getPublicCoreAnnouncement(), { enabled: false })
  })
  await check('保存标题、副标题、段落与空行', () => {
    const saved = api.setCoreAnnouncement(draft)
    assert.equal(saved.title, '维护公告')
    assert.deepEqual(saved.body, draft.body)
    assert.ok(Number.isFinite(Date.parse(saved.updatedAt)))
    assert.deepEqual(api.getPublicCoreAnnouncement(), saved)
  })
  await check('数据库重新打开后仍读取已保存公告', () => {
    db.close()
    db = new DatabaseSync(join(directory, 'test.db'))
    api = loadBusiness()
    assert.equal(api.getCoreAnnouncement().title, '维护公告')
    assert.deepEqual(api.getCoreAnnouncement().body, draft.body)
  })
  await check('停用保留草稿，公开接口只返回停用标记', () => {
    api.setCoreAnnouncement({ ...draft, enabled: false })
    assert.deepEqual(api.getPublicCoreAnnouncement(), { enabled: false })
    assert.deepEqual(api.getCoreAnnouncement().body, draft.body)
  })
  const invalid = [null, [], {}, { ...draft, enabled: 'true' }, { ...draft, title: 1 }, { ...draft, title: ' ' },
    { ...draft, title: '字'.repeat(81) }, { ...draft, title: '标题\n换行' }, { ...draft, subtitle: null },
    { ...draft, subtitle: '字'.repeat(161) }, { ...draft, body: [] }, { ...draft, body: [' ', ''] },
    { ...draft, body: [123] }, { ...draft, body: ['字'.repeat(501)] }, { ...draft, body: ['换\n行'] },
    { ...draft, body: ['控制\u0000字符'] }, { ...draft, body: Array(121).fill('段落') },
    { ...draft, body: Array(40).fill('字'.repeat(500)) }]
  for (const [index, value] of invalid.entries()) {
    await check(`拒绝无效格式或超限内容 ${index + 1}，不覆盖原数据`, () => {
      const before = api.getCoreAnnouncement()
      reject(() => api.setCoreAnnouncement(value))
      assert.deepEqual(api.getCoreAnnouncement(), before)
    })
  }
  await check('允许边界大小的正文与标题', () => {
    const body = [...Array(39).fill('字'.repeat(500)), '字'.repeat(461)]
    assert.equal(body.join('\n').length, 20_000)
    assert.equal(api.setCoreAnnouncement({ ...draft, title: '字'.repeat(80), subtitle: '字'.repeat(160), body }).body.length, 40)
  })
  await check('页面路由、导航和管理 API 权限均已登记', () => {
    assert.equal(pagePermissions.adminPageKeyForPath('/core-announcement'), 'core-announcement')
    assert.ok(pagePermissions.ADMIN_NAVIGATION_ORDER.includes('core-announcement'))
    assert.equal(apiPermissions.pageKeyForApi('/api/admin/core-announcement'), 'core-announcement')
    assert.equal(apiPermissions.pageKeyForApi('/api/announcement/core'), undefined)
  })
  const adminGet = route('server/api/admin/core-announcement.get.ts', api)
  const adminPatch = route('server/api/admin/core-announcement.patch.ts', api)
  const publicGet = route('server/api/announcement/core.get.ts', api)
  const viewer = { user: { permissions: { 'core-announcement': 'view' } }, body: draft }
  await check('未登录与隐藏权限不能读取后台草稿', () => {
    reject(() => adminGet({}), 401)
    reject(() => adminGet({ user: { permissions: { 'core-announcement': 'hidden' } } }), 403)
  })
  await check('只读管理员能查看，不能修改公告', async () => {
    assert.ok(adminGet(viewer).body.length)
    await assert.rejects(() => adminPatch(viewer), (error) => error.statusCode === 403)
    await assert.rejects(() => adminPatch({ body: draft }), (error) => error.statusCode === 401)
  })
  await check('编辑管理员可发布，公开读取不需登录且禁止缓存', async () => {
    const saved = await adminPatch({ user: { permissions: { 'core-announcement': 'edit' } }, body: draft })
    const event = { headers: {} }
    assert.deepEqual(publicGet(event), saved)
    assert.equal(event.headers['Cache-Control'], 'no-store')
  })
  process.stdout.write(`通过 ${checks} 项公告 SQLite／输入／权限检查。\n`)
} finally {
  db?.close()
  rmSync(directory, { recursive: true, force: true })
}
