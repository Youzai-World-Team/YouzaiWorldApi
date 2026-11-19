// 隔离验证地图定位、缓存、位置记忆和权限；不启动服务、不读取运行期数据库。
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import assert from 'node:assert/strict'
import { ref, computed, watch, nextTick, effectScope } from 'vue'
const root = new URL('../', import.meta.url)
const read = file => readFileSync(new URL(file, root), 'utf8').replace(/\r\n/g, '\n')
const withoutImports = value => value.replace(/import[\s\S]*?from ['"][^'"]+['"]\s*/g, '')
const source = [read('shared/game-map.ts'), withoutImports(read('shared/game-map-view.ts')),
  withoutImports(read('app/utils/game-map-cache.ts')), withoutImports(read('app/utils/game-map-preferences.ts')),
  read('shared/admin-page-permissions.ts'), read('shared/admin-api-permissions.ts')].join('\n')
const js = stripTypeScriptTypes(source.replace(/\bexport /g, ''))
const api = new Function(`${js}\nreturn {uncoveredMapRectangles,mapOverviewFocus,mapOverviewCellSize,mapFitScale,mapPinchView,parseMapLocation,GameMapTileCache,readMapPreferences,pruneMapPreferences,rememberMapView,emptyMapPreferences,defaultAdminFeaturePermissions,ownerAdminFeaturePermissions,defaultAdminPagePermissions,ownerAdminPagePermissions,permissionAllows,pageKeyForApi,ADMIN_FEATURE_DEFINITIONS}`)()
let checks = 0
const check = (label, fn) => { fn(); checks++; process.stdout.write(`✓ ${label}\n`) }
const checkAsync = async (label, fn) => { await fn(); checks++; process.stdout.write(`✓ ${label}\n`) }
const rect = (minX, minZ, maxX, maxZ) => ({ minX, minZ, maxX, maxZ })
check('分散记录的默认定位不落在两片区域之间', () => assert.deepEqual(api.mapOverviewFocus([
  { x: 0, z: 0, count: 1, focus_x: 0, focus_z: 0 }, { x: 1000, z: 0, count: 4, focus_x: 1000, focus_z: 0 },
]), { x: 16008, z: 8 }))
check('跨世界边界的总览保持有限区域数量', () => {
  const size = api.mapOverviewCellSize(rect(-1874999, -1874999, 1874999, 1874999))
  assert.ok(Math.floor(1874999 / size) - Math.floor(-1874999 / size) + 1 <= 64)
})
check('进入小区域自动缩放，宽区域交给总览', () => {
  assert.ok(api.mapFitScale(rect(0, 0, 3, 3), 900, 560) >= 2)
  assert.ok(api.mapFitScale(rect(-100000, 0, 100000, 0), 900, 560) >= 900 / (62 * 16))
})
check('平移只补读新进入的条带', () => assert.deepEqual(api.uncoveredMapRectangles(rect(-1, -1, 3, 2), [rect(-1, -1, 2, 2)]), [rect(3, -1, 3, 2)]))
check('重叠覆盖范围既不重复请求也不漏区块', () => {
  const view = rect(-3, -3, 3, 3), covered = [rect(-1, -1, 1, 1), rect(0, 0, 2, 2)]
  const missing = api.uncoveredMapRectangles(view, covered)
  const points = new Set()
  for (const value of missing) for (let z = value.minZ; z <= value.maxZ; z++) for (let x = value.minX; x <= value.maxX; x++) {
    const key = `${x},${z}`; assert.ok(!points.has(key)); points.add(key)
  }
  const isCovered = (x, z) => covered.some(value => x >= value.minX && x <= value.maxX && z >= value.minZ && z <= value.maxZ)
  for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) assert.equal(points.has(`${x},${z}`), !isCovered(x, z))
  assert.equal(api.uncoveredMapRectangles(view, [view]).length, 0)
})
check('缓存保留原地形与已确认的空白范围', () => {
  const cache = new api.GameMapTileCache()
  cache.put('world|data|surface', -1, -1, new Uint8Array(1792))
  cache.complete('world|data|surface', rect(-2, -2, 1, 1))
  assert.equal(cache.visible('world|data|surface', rect(-2, -2, 1, 1)).length, 1)
  assert.equal(cache.missing('world|data|surface', rect(-2, -2, 1, 1)).length, 0)
  cache.invalidate('world')
  assert.equal(cache.visible('world|data|surface', rect(-2, -2, 1, 1)).length, 1)
  assert.equal(cache.missing('world|data|surface', rect(-2, -2, 1, 1)).length, 1)
})
check('瓦片淘汰后不会误判该范围仍被完整缓存', () => {
  const cache = new api.GameMapTileCache(), scope = 'world|data|surface'
  cache.put(scope, 0, 0, new Uint8Array(1)); cache.complete(scope, rect(0, 0, 0, 0))
  for (let x = 1; x <= 4096; x++) cache.put(scope, x, 0, new Uint8Array(1))
  assert.equal(cache.get(scope, 0, 0), undefined)
  assert.equal(cache.missing(scope, rect(0, 0, 0, 0)).length, 1)
})
check('双指缩放和平移保持指下的世界位置', () => {
  const start = { x: -100, z: 200, scale: 2, distance: 100, midpoint: { x: 100, z: 150 } }
  const midpoint = { x: 130, z: 170 }, value = api.mapPinchView(start, midpoint, 200, 900, 560, .5)
  assert.equal(value.scale, 4)
  assert.equal(value.x + (midpoint.x - 450) / value.scale, start.x + (start.midpoint.x - 450) / start.scale)
  assert.equal(value.z + (midpoint.z - 280) / value.scale, start.z + (start.midpoint.z - 280) / start.scale)
})
check('支持粘贴游戏坐标并拒绝无效边界', () => {
  assert.deepEqual(api.parseMapLocation('-12 48'), { x: -12, z: 48 })
  assert.deepEqual(api.parseMapLocation('-12, 64, 48'), { x: -12, y: 64, z: 48 })
  assert.deepEqual(api.parseMapLocation('X：-12 Y：64 Z：48'), { x: -12, y: 64, z: 48 })
  for (const value of ['abc', '1', '1 2 3 4', '999999999 0', '1 9000 2']) assert.equal(api.parseMapLocation(value), null)
})
const saved = { world: 'world', dataId: 'old', dimension: 'minecraft:overworld', layer: 'CAVE', height: -48, x: -123, z: 456, scale: 2 }
check('保存的图层和坐标可一起恢复', () => {
  const value = api.rememberMapView(api.emptyMapPreferences(), saved)
  assert.deepEqual(api.readMapPreferences(JSON.stringify(value)).views[0], saved)
})
check('同 UUID 地图重置后旧地标和位置失效', () => {
  const value = { ...api.rememberMapView(api.emptyMapPreferences(), saved), landmarks: [{ ...saved, id: 'one', name: '旧主城' }], recent: [saved] }
  const worlds = [{ id: 'world', data_id: 'new', dimensions: [{ id: 'minecraft:overworld' }] }]
  const current = api.pruneMapPreferences(value, worlds)
  assert.equal(current.views.length + current.landmarks.length + current.recent.length, 0)
})
check('损坏的浏览器设置不影响地图打开', () => assert.deepEqual(api.readMapPreferences('{bad json'), api.emptyMapPreferences()))
const dbSource = read('server/utils/db.ts')
const permissionLogic = [dbSource.slice(dbSource.indexOf('export function adminFeatureAllows('), dbSource.indexOf('/**\n * 多个页面共用的接口：')),
  dbSource.slice(dbSource.indexOf('export function requireFeaturePermission('), dbSource.indexOf('export function requireOwner('))].join('\n')
let actor
const auth = new Function('requireAuth', 'createError', 'ADMIN_FEATURE_DEFINITIONS', 'permissionAllows', stripTypeScriptTypes(permissionLogic.replace(/\bexport /g, '')) + '\nreturn {requireFeaturePermission}')
  (() => actor, options => Object.assign(new Error(options.statusMessage), options), api.ADMIN_FEATURE_DEFINITIONS, api.permissionAllows)
check('地图清空接口归属站点设置权限', () => assert.equal(api.pageKeyForApi('/api/admin/game-map-data/reset'), 'settings'))
check('玩家位置读取接口沿用地图查看权限', () => assert.equal(api.pageKeyForApi('/api/admin/game-maps/players'), 'game-maps'))
check('普通管理员默认不能清空，即使站点设置可编辑', () => {
  actor = { permissions: { settings: 'edit' }, featurePermissions: api.defaultAdminFeaturePermissions() }
  assert.throws(() => auth.requireFeaturePermission({}, 'settings-game-maps', 'edit'), error => error.statusCode === 403)
})
check('初始管理员默认可以清空', () => {
  actor = { permissions: api.ownerAdminPagePermissions(), featurePermissions: api.ownerAdminFeaturePermissions() }
  assert.equal(auth.requireFeaturePermission({}, 'settings-game-maps', 'edit'), actor)
})
check('明确授权的普通管理员仍受站点设置页面权限限制', () => {
  actor = { permissions: { settings: 'view' }, featurePermissions: { 'settings-game-maps': 'edit' } }
  assert.throws(() => auth.requireFeaturePermission({}, 'settings-game-maps', 'edit'), error => error.statusCode === 403)
  actor.permissions.settings = 'edit'
  assert.equal(auth.requireFeaturePermission({}, 'settings-game-maps', 'edit'), actor)
})
// 使用真实 composable 和 Vue 响应式，DOM、时钟及 HTTP 由隔离夹具提供。
const mounted = [], unmounted = [], timeouts = new Map(), intervals = new Map(), frames = new Map(), requests = [], images = []
let timerId = 0, fixtureNow = 1000000
let copiedCoordinates = '', overridePlayers = null
const store = new Map()
const context = { setTransform() {}, clearRect() {}, drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, strokeText() {}, fillText() {} }
const element = { width: 900, height: 560, getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 560 }),
  getContext: () => context, focus() {}, setPointerCapture() {} }
const worldId = '11111111-1111-1111-1111-111111111111'
const dataId = '22222222-2222-2222-2222-222222222222'
const world = { id: worldId, data_id: dataId, name: '隔离存档', source_revision: 1, upload_batch: 0, syncing: false,
  last_success: fixtureNow, last_activity: fixtureNow, tile_count: 4, dimensions: [{ id: 'minecraft:overworld', min_y: -64, max_y: 319 }],
  layers: [
    { dimension: 'minecraft:overworld', layer: 'SURFACE', height: 0, tile_count: 2, min_x: 0, min_z: 0, max_x: 1000, max_z: 0 },
    { dimension: 'minecraft:overworld', layer: 'CAVE', height: 64, tile_count: 1, min_x: -200, min_z: 0, max_x: -200, max_z: 0 },
    { dimension: 'minecraft:overworld', layer: 'CAVE', height: 56, tile_count: 1, min_x: -200, min_z: 0, max_x: -200, max_z: 0 },
  ] }
const index = { worlds: [world], reset: null, diagnostics: { game_api_configured: true, panel_bound: true } }
const player = { uuid: '44444444-4444-4444-4444-444444444444', name: '测试玩家', dimension: 'minecraft:overworld',
  x: 16020.75, y: 85.5, z: 8.25, recorded_at: fixtureNow - 60_000, source: 'login' }
const netherPlayer = { ...player, uuid: '55555555-5555-5555-5555-555555555555', name: '下界玩家',
  dimension: 'minecraft:the_nether', x: -32.75, y: 120.5, z: -128.25 }
const players = [player, netherPlayer]
world.dimensions.push({ id: 'minecraft:the_nether', min_y: 0, max_y: 255 })
world.player_count = players.length; world.player_updated_at = fixtureNow
const bytes = Buffer.alloc(1792)
for (let i = 0; i < 256; i++) { bytes[i * 4 + 3] = 255; bytes.writeInt16BE(64, 1024 + i * 2) }
const fetch = async (path, options = {}) => {
  requests.push({ path, ...options })
  if (path === '/api/admin/game-maps') return structuredClone(index)
  if (path.endsWith('/players')) {
    if (overridePlayers) return overridePlayers(options)
    return { world: options.query.world, data_id: options.query.data_id, players: structuredClone(players) }
  }
  const cave = options.query?.layer === 'CAVE', x = cave ? -200 : 1000
  if (path.endsWith('/overview')) return { cell_size: 16, min_x: cave ? -200 : 0, min_z: 0, max_x: x, max_z: 0,
    focus_x: x * 16 + 8, focus_z: 8, cells: [{ x: Math.floor(x / 16), z: 0, count: 1, focus_x: x, focus_z: 0 }] }
  if (path.endsWith('/tiles')) return { tiles: x >= options.query.min_x && x <= options.query.max_x && options.query.min_z <= 0 && options.query.max_z >= 0
    ? [{ x, z: 0, data: bytes.toString('base64') }] : [], next: null }
  throw new Error('不应访问的测试地址 ' + path)
}
const environment = { ref, computed, watch, nextTick, onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn),
  useAdminAccess: () => ({ user: ref({ id: 7 }), levelForKey: () => 'edit', featureLevelForKey: () => 'edit' }),
  useToast: () => ({ showToast() {} }), $fetch: fetch, GameMapTileCache: api.GameMapTileCache,
  mapTileCanvas: (tile, light) => { images.push({ tile, light }); return element },
  MAP_CHUNK_LIMIT: 1874999, MAP_TILE_BYTES: 1792, MAP_UPLOAD_COMMAND: 'yzwc map upload', MAP_BLOCK_LIMIT: 1874999 * 16, MAP_DETAIL_CHUNKS: 64,
  mapFitScale: api.mapFitScale, mapPinchView: api.mapPinchView, parseMapLocation: api.parseMapLocation,
  MAX_MAP_LANDMARKS: 50, emptyMapPreferences: api.emptyMapPreferences, pruneMapPreferences: api.pruneMapPreferences,
  readMapPreferences: api.readMapPreferences, rememberMapView: api.rememberMapView,
  rememberMapDestination: (value, place) => ({ ...value, recent: [place, ...value.recent].slice(0, 8) }),
  localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) },
  navigator: { clipboard: { writeText: async value => { copiedCoordinates = value } } },
  Date: { now: () => fixtureNow }, window: { devicePixelRatio: 1 }, document: { hidden: false, addEventListener() {}, removeEventListener() {}, fullscreenElement: null },
  ResizeObserver: class { observe() {} disconnect() {} }, getComputedStyle: () => ({ getPropertyValue: () => '#4469bd' }),
  requestAnimationFrame: fn => { const id = ++timerId; frames.set(id, fn); return id }, cancelAnimationFrame: id => frames.delete(id),
  setTimeout: (fn, delay) => { const id = ++timerId; timeouts.set(id, { fn, delay }); return id }, clearTimeout: id => timeouts.delete(id),
  setInterval: (fn, delay) => { const id = ++timerId; intervals.set(id, { fn, delay }); return id }, clearInterval: id => intervals.delete(id),
}
const controllerSource = stripTypeScriptTypes(withoutImports(read('app/composables/useGameMap.ts')).replace(/\bexport /g, ''))
const makeView = new Function(...Object.keys(environment), controllerSource + '\nreturn useGameMap')(...Object.values(environment))
const scope = effectScope(), browser = scope.run(makeView)
browser.card.value = element; browser.surface.value = element; browser.container.value = element
const drain = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); await nextTick() }; for (const [id, fn] of [...frames]) { frames.delete(id); fn() } }
const loadTiles = async () => { for (const [id, task] of [...timeouts]) if (task.delay === 180) { timeouts.delete(id); task.fn() }; await drain() }
await checkAsync('实际浏览流程首次打开直接进入已记录区域', async () => {
  for (const fn of mounted) await fn()
  await loadTiles()
  assert.equal(browser.centerX.value, 16008)
  assert.equal(browser.loaded.value, 1)
})
await checkAsync('切换地下图层与高度保留当前坐标和缩放', async () => {
  const before = [browser.centerX.value, browser.centerZ.value, browser.scale.value]
  browser.setLayer('CAVE'); await drain(); browser.chooseHeight(56); await loadTiles()
  assert.deepEqual([browser.centerX.value, browser.centerZ.value, browser.scale.value], before)
  assert.equal(browser.height.value, 56)
  browser.setLayer('SURFACE'); browser.setLayer('CAVE')
  assert.equal(browser.height.value, 56)
})
await checkAsync('改变光照只本地重绘，不重新请求地形', async () => {
  browser.setLayer('SURFACE'); await loadTiles()
  const before = requests.filter(value => value.path.endsWith('/tiles')).length
  browser.lighting.value = true; await drain()
  assert.equal(requests.filter(value => value.path.endsWith('/tiles')).length, before)
  assert.ok(images.some(value => value.light === true))
})
await checkAsync('拖动未发出新请求前仍显示已有地形', async () => {
  browser.pointerDown({ button: 0, pointerId: 1, clientX: 450, clientY: 280 })
  browser.pointerMove({ pointerId: 1, clientX: 470, clientY: 280 }); await drain()
  assert.equal(browser.loaded.value, 1)
  browser.pointerUp({ type: 'pointerup', pointerId: 1, clientX: 470, clientY: 280 }); await loadTiles()
})
await checkAsync('实际同步状态随时钟更新并检测上传停顿', async () => {
  world.syncing = true; world.last_activity = fixtureNow
  await browser.refreshWorlds(false); assert.equal(browser.stalled.value, false)
  fixtureNow += 10 * 60000
  for (const task of intervals.values()) if (task.delay === 10000) task.fn()
  assert.equal(browser.stalled.value, true)
  assert.match(browser.syncText.value, /停顿/)
})
await checkAsync('自动轮询会读取完成后的实际同步状态', async () => {
  world.syncing = false; world.last_success = fixtureNow
  for (const task of intervals.values()) if (task.delay === 15000) task.fn()
  await drain()
  assert.equal(browser.syncText.value, '已保存地图快照')
  assert.equal(browser.snapshotAge.value, '不到一分钟前')
})
await checkAsync('首次读取玩家位置，状态未变化时不重复下载', async () => {
  assert.equal(browser.players.value.length, 2)
  assert.equal(browser.playersError.value, '')
  const before = requests.filter(value => value.path.endsWith('/players')).length
  await browser.refreshWorlds(false); await drain()
  assert.equal(requests.filter(value => value.path.endsWith('/players')).length, before)
})
await checkAsync('只更新玩家位置时不重新下载地形或移动浏览中心', async () => {
  const before = requests.filter(value => value.path.endsWith('/tiles')).length
  const center = [browser.centerX.value, browser.centerZ.value, browser.scale.value]
  player.x += 10; player.recorded_at += 100; player.source = 'logout'; world.player_updated_at++
  await browser.refreshWorlds(false); await loadTiles()
  assert.equal(browser.players.value[0].x, player.x)
  assert.deepEqual([browser.centerX.value, browser.centerZ.value, browser.scale.value], center)
  assert.equal(requests.filter(value => value.path.endsWith('/tiles')).length, before)
})
await checkAsync('点击列表跨维度定位；无地形时轮询仍保留所选玩家', async () => {
  await browser.jumpPlayer(browser.players.value[1]); await loadTiles()
  assert.equal(browser.dimension.value, 'minecraft:the_nether')
  assert.deepEqual([browser.centerX.value, browser.centerZ.value], [netherPlayer.x, netherPlayer.z])
  assert.equal(browser.selectedPlayer.value.uuid, netherPlayer.uuid)
  await browser.refreshWorlds(false); await loadTiles()
  assert.equal(browser.dimension.value, 'minecraft:the_nether')
  assert.deepEqual([browser.centerX.value, browser.centerZ.value], [netherPlayer.x, netherPlayer.z])
  await browser.jumpPlayer(browser.players.value[0]); await loadTiles()
})
await checkAsync('选中玩家复制真实 Y 坐标，关闭标记后点击恢复普通选点', async () => {
  await browser.copyCoordinates()
  assert.equal(copiedCoordinates, `X: ${Math.floor(player.x)} Y: ${Math.floor(player.y)} Z: ${Math.floor(player.z)}`)
  browser.showPlayers.value = false
  browser.pointerDown({ button: 0, pointerId: 2, clientX: 450, clientY: 280 })
  browser.pointerUp({ type: 'pointerup', pointerId: 2, clientX: 450, clientY: 280 }); await drain()
  assert.equal(browser.selectedPlayer.value, undefined)
  browser.showPlayers.value = true
  browser.pointerDown({ button: 0, pointerId: 3, clientX: 450, clientY: 280 })
  browser.pointerUp({ type: 'pointerup', pointerId: 3, clientX: 450, clientY: 280 }); await loadTiles()
  assert.equal(browser.selectedPlayer.value.uuid, player.uuid)
})
await checkAsync('读取位置失败保留已显示快照并允许重试', async () => {
  overridePlayers = async () => { throw new Error('测试网络故障') }
  await browser.loadPlayers(true)
  assert.match(browser.playersError.value, /读取失败/)
  assert.equal(browser.players.value.length, 2)
  overridePlayers = null
  await browser.loadPlayers(true); await drain()
  assert.equal(browser.playersError.value, '')
})
await checkAsync('实际存档身份变化后删除旧地标和浏览位置', async () => {
  browser.landmarkName.value = '旧基地'; browser.saveLandmark()
  assert.equal(browser.landmarks.value.length, 1)
  world.data_id = '33333333-3333-3333-3333-333333333333'
  await browser.refreshWorlds(false); await loadTiles()
  assert.equal(browser.landmarks.value.length, 0)
  assert.equal(browser.recent.value.length, 0)
  assert.equal(browser.centerX.value, 16008)
})
await checkAsync('清空期间迟到的位置响应不会显示在新地图', async () => {
  let resolveOld
  const oldIdentity = world.data_id
  overridePlayers = () => { overridePlayers = null; return new Promise(resolve => { resolveOld = resolve }) }
  const pending = browser.loadPlayers(true)
  world.data_id = '66666666-6666-6666-6666-666666666666'
  players.length = 0; world.player_count = 0; world.player_updated_at = 0
  await browser.refreshWorlds(false); await drain()
  assert.equal(browser.players.value.length, 0)
  resolveOld({ world: worldId, data_id: oldIdentity, players: [player] })
  await pending; await loadTiles()
  assert.equal(browser.players.value.length, 0)
  assert.equal(browser.selectedPlayer.value, undefined)
})
for (const fn of unmounted) fn()
scope.stop()
assert.equal(timeouts.size + intervals.size + frames.size, 0)
process.stdout.write(`通过 ${checks} 项地图交互与权限检查。\n`)
