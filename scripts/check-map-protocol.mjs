// 运行实际地图解析器、SQL 建表及业务函数；隔离内存库，不打开运行期数据库。
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const root = new URL('../', import.meta.url)
const read = (file) => readFileSync(new URL(file, root), 'utf8').replace(/\r\n/g, '\n')
const shared = read('shared/game-map.ts')
const viewSource = read('shared/game-map-view.ts').replace(/import[\s\S]*?from ['"][^'"]+['"]\s*/g, '')
const input = read('server/utils/game-map-input.ts').replace(/import[\s\S]*?from ['"][^'"]+['"]\s*/g, '')
const source = read('server/utils/db.ts')
const schema = source.slice(source.indexOf('  CREATE TABLE IF NOT EXISTS game_map_v2_worlds'), source.indexOf('  CREATE TABLE IF NOT EXISTS status_history'))
const logic = source.slice(source.indexOf('// ===== 已加载地图：'))
const js = stripTypeScriptTypes([shared, viewSource, input, logic].join('\n').replace(/\bexport /g, ''))
const createError = (options) => Object.assign(new Error(options.statusMessage), options)
const load = (db) => {
  const getSetting = key => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value
  const setSetting = (key, value) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  return new Function('db', 'createHash', 'createError', 'randomUUID', 'getSetting', 'setSetting', 'getGameApiKey', 'mcsmConfigured', 'getMcsmManagedInstance',
    `${js}\nreturn {parseMapUpload,uploadGameMap,listGameMapWorlds,readGameMapTiles,parseMapViewport,readGameMapOverview,clearGameMapData,getGameMapIndex,updateGameMapResetRequest,parseMapPlayers,uploadGameMapPlayers,readGameMapPlayers}`)
    (db, createHash, createError, randomUUID, getSetting, setSetting, () => 'a'.repeat(32), () => false, () => null)
}
const db = new DatabaseSync(':memory:'); db.exec(schema)
const api = load(db)
let checks = 0
const check = (label, fn) => { fn(); checks++; process.stdout.write(`✓ ${label}\n`) }
const world = randomUUID(), run = randomUUID()
const raw = (phase, revision = 2, runId = run, batch = 0) => ({ version: 2, source: 'minecraft_chunk_storage', world_id: world, run_id: runId, phase, revision, batch })
const begin = (revision = 2, runId = run) => ({ ...raw('begin', revision, runId), name: '测试存档', dimensions: [{ id: 'minecraft:overworld', min_y: -64, max_y: 319 }] })
const data = Buffer.alloc(1792)
for (let i = 0; i < 256; i++) { data[i * 4 + 3] = 255; data.writeInt16BE(64, 1024 + i * 2) }
const tile = (x, revision, value = data) => ({ dimension: 'minecraft:overworld', layer: 'SURFACE', height: 0, x, z: -1, revision, data: value.toString('base64') })
const send = (value) => api.uploadGameMap(api.parseMapUpload(value))
const dataId = (id = world) => db.prepare('SELECT data_id FROM game_map_v2_worlds WHERE id = ?').get(id)?.data_id
const beginReply = (full, revision, id = world) => ({ ok: true, full_required: full, accepted_revision: revision, data_id: dataId(id) })
const reject = (fn, status) => assert.throws(fn, (error) => error.statusCode === status)
check('拒绝旧版协议', () => reject(() => api.parseMapUpload({ ...begin(), version: 1 }), 400))
check('拒绝客户端数据来源', () => reject(() => api.parseMapUpload({ ...begin(), source: 'player_client' }), 400))
check('首次同步要求全量并返回数据标识', () => { const reply = send(begin()); assert.deepEqual(reply, beginReply(true, 0)); assert.match(reply.data_id, /^[0-9a-f-]{36}$/) })
check('拒绝改变会话修订范围', () => reject(() => send(begin(3)), 409))
const batch = { ...raw('tiles'), tiles: [tile(-1, 1), tile(0, 2)] }
check('事务保存负坐标瓦片', () => { send(batch); assert.equal(api.listGameMapWorlds()[0].tile_count, 2) })
check('同一批次重试不重复计数', () => { send(batch); assert.equal(api.listGameMapWorlds()[0].tile_count, 2) })
check('拒绝同序号不同内容', () => reject(() => send({ ...batch, tiles: [tile(2, 1)] }), 409))
check('未完成不推进源修订号', () => assert.equal(api.listGameMapWorlds()[0].source_revision, 0))
check('拒绝不完整结束批次', () => reject(() => send(raw('complete', 2, run, 0)), 409))
check('完整确认推进修订号', () => { send(raw('complete', 2, run, 1)); assert.equal(api.listGameMapWorlds()[0].source_revision, 2) })
check('结束确认可重试', () => { send(raw('complete', 2, run, 1)); assert.equal(api.listGameMapWorlds()[0].tile_count, 2) })
check('拒绝来源修订号倒退', () => reject(() => send(begin(1, randomUUID())), 409))
const next = randomUUID()
check('增量返回已确认游标', () => assert.deepEqual(send(begin(4, next)), beginReply(false, 2)))
check('拒绝超过快照范围的瓦片', () => reject(() => send({ ...raw('tiles', 4, next), tiles: [tile(0, 5)] }), 400))
check('整批校验失败不写入前面的有效瓦片', () => {
  reject(() => send({ ...raw('tiles', 4, next), tiles: [tile(3, 3), { ...tile(4, 4), dimension: 'invalid:dimension' }] }), 400)
  assert.equal(api.listGameMapWorlds()[0].tile_count, 2)
})
const updated = Buffer.from(data); updated[0] = 100
check('修改区块覆盖原瓦片而非追加计数', () => {
  send({ ...raw('tiles', 4, next), tiles: [tile(-1, 3, updated), tile(2, 4)] })
  assert.equal(api.listGameMapWorlds()[0].tile_count, 3)
})
check('中断上传保留旧完成时间与进度', () => assert.equal(api.listGameMapWorlds()[0].source_revision, 2))
const retry = randomUUID()
check('新会话重新补传中断范围', () => { assert.equal(send(begin(4, retry)).accepted_revision, 2); send({ ...raw('tiles', 4, retry), tiles: [tile(-1, 3, updated), tile(2, 4)] }); send(raw('complete', 4, retry, 1)); assert.equal(api.listGameMapWorlds()[0].source_revision, 4) })
check('旧会话不能写入新会话', () => reject(() => send(raw('complete', 4, next, 1)), 409))
const view = api.parseMapViewport({ world, dimension: 'minecraft:overworld', layer: 'SURFACE', height: '0', min_x: '-1', max_x: '2', min_z: '-1', max_z: '-1' })
check('读取负坐标范围与覆盖后的内容', () => { const result = api.readGameMapTiles(view); assert.equal(result.tiles.length, 3); assert.equal(Buffer.from(result.tiles[0].data, 'base64')[0], 100) })
check('不同存档数据隔离', () => reject(() => api.readGameMapTiles({ ...view, worldId: randomUUID() }), 404))
check('拒绝重复瓦片键', () => reject(() => api.parseMapUpload({ ...raw('tiles'), tiles: [tile(0, 1), tile(0, 2)] }), 400))
check('拒绝超大批次', () => reject(() => api.parseMapUpload({ ...raw('tiles'), tiles: Array.from({ length: 129 }, (_, x) => tile(x, 1)) }), 400))
check('拒绝无效像素长度', () => reject(() => api.parseMapUpload({ ...raw('tiles'), tiles: [tile(0, 1, Buffer.alloc(12))] }), 400))
check('拒绝非法视口', () => reject(() => api.parseMapViewport({ world, dimension: 'minecraft:overworld', layer: 'SURFACE', height: '0', min_x: '0', max_x: '256', min_z: '0', max_z: '0' }), 400))
check('旧瓦片修订不能覆盖更新后的内容', () => {
  const id = randomUUID()
  send(begin(5, id))
  send({ ...raw('tiles', 5, id), tiles: [tile(-1, 1)] })
  send(raw('complete', 5, id, 1))
  assert.equal(Buffer.from(api.readGameMapTiles(view).tiles[0].data, 'base64')[0], 100)
})
check('完整视口跨页读取不丢失或重复瓦片', () => {
  const id = randomUUID(), revision = 600
  send(begin(revision, id))
  for (let batch = 0; batch < 3; batch++) {
    send({ ...raw('tiles', revision, id, batch), tiles: Array.from({ length: 100 }, (_, i) => tile(100 + batch * 100 + i, 10 + batch * 100 + i)) })
  }
  send(raw('complete', revision, id, 3))
  const query = { ...view, minX: 100, maxX: 355, minZ: -2, maxZ: -1, after: -1 }
  const first = api.readGameMapTiles(query)
  // 再加入第二行，使合法视口内的总瓦片数超过一页。
  const nextId = randomUUID()
  send(begin(601, nextId))
  send({ ...raw('tiles', 601, nextId), tiles: [{ ...tile(100, 601), z: -2 }] })
  send(raw('complete', 601, nextId, 1))
  const page = api.readGameMapTiles(query)
  const last = api.readGameMapTiles({ ...query, after: page.next })
  assert.equal(first.tiles.length, 256)
  assert.equal(page.tiles.length, 256)
  assert.notEqual(page.next, null)
  assert.equal(last.tiles.length, 1)
  assert.equal(last.next, null)
  assert.equal(new Set([...page.tiles, ...last.tiles].map(t => `${t.x},${t.z}`)).size, 257)
})
check('总览定位点属于已保存的真实区块', () => {
  const overview = api.readGameMapOverview(view)
  assert.ok(overview.cells.length > 0 && overview.cells.length <= 4096)
  assert.ok(db.prepare('SELECT 1 FROM game_map_v2_tiles WHERE world_id = ? AND x = ? AND z = ?')
    .get(world, Math.floor(overview.focus_x / 16), Math.floor(overview.focus_z / 16)))
  for (const cell of overview.cells) {
    assert.equal(Math.floor(cell.focus_x / overview.cell_size), cell.x)
    assert.equal(Math.floor(cell.focus_z / overview.cell_size), cell.z)
  }
})
check('没有记录的地下层返回空总览', () => assert.equal(api.readGameMapOverview({ ...view, layer: 'CAVE', height: -64 }).cells.length, 0))
const previousDataId = api.listGameMapWorlds()[0].data_id
check('增量同步保留地图数据身份', () => {
  send(begin(602, randomUUID()))
  assert.equal(api.listGameMapWorlds()[0].data_id, previousDataId)
})
check('新批次会刷新缓存的总览', () => {
  api.readGameMapOverview(view)
  const id = randomUUID()
  send(begin(603, id))
  send({ ...raw('tiles', 603, id), tiles: [tile(-100000, 603)] })
  send(raw('complete', 603, id, 1))
  const overview = api.readGameMapOverview(view)
  assert.equal(overview.min_x, -100000)
  for (const cell of overview.cells) assert.equal(Math.floor(cell.focus_x / overview.cell_size), cell.x)
})
check('另一进程上传后总览缓存按数据库进度失效', () => {
  const sibling = load(db)
  const before = sibling.readGameMapOverview(view)
  const id = randomUUID()
  send(begin(604, id)); send({ ...raw('tiles', 604, id), tiles: [tile(100000, 604)] }); send(raw('complete', 604, id, 1))
  assert.ok(sibling.readGameMapOverview(view).max_x > before.max_x)
})
const otherWorld = randomUUID(), otherRun = randomUUID()
send({ ...begin(1, otherRun), world_id: otherWorld, name: '保留存档' })
send({ ...raw('tiles', 1, otherRun), world_id: otherWorld, tiles: [tile(10, 1)] })
send({ ...raw('complete', 1, otherRun, 1), world_id: otherWorld })
const playerTime = Date.now() - 60_000
const player = { uuid: randomUUID(), name: '测试玩家', dimension: 'minecraft:overworld',
  x: -1.25, y: 80.5, z: -32.75, recorded_at: playerTime, source: 'login' }
const playerBody = (id, players, identity = dataId(id)) => ({ version: 2, source: 'minecraft_server', world_id: id, data_id: identity, players })
const sendPlayers = body => api.uploadGameMapPlayers(api.parseMapPlayers(body))
const readPlayers = (id = world) => api.readGameMapPlayers(id, dataId(id)).players.map(value => ({ ...value }))
check('玩家快照参数拒绝重复、越界、非有限数、未来时间与登录大厅', () => {
  for (const patch of [{ x: Infinity }, { y: NaN }, { z: 30_000_000 }, { y: -4097 },
    { recorded_at: Date.now() + 600_000 }, { recorded_at: '123' }, { source: 'online' },
    { name: '含\n换行' }, { uuid: 'invalid' }, { dimension: 'youzaiworldcore:login_hall' }]) {
    reject(() => sendPlayers(playerBody(world, [{ ...player, ...patch }])), 400)
  }
  reject(() => sendPlayers(playerBody(world, [player, player])), 400)
  reject(() => sendPlayers(playerBody(world, [])), 400)
  reject(() => sendPlayers({ ...playerBody(world, [player]), source: 'player_client' }), 400)
  reject(() => sendPlayers(playerBody(world, Array.from({ length: 257 }, () => ({ ...player, uuid: randomUUID() })))), 400)
  assert.equal(readPlayers().length, 0)
})
check('玩家位置按存档保存负数和小数，不改动地形同步状态', () => {
  const before = api.listGameMapWorlds().find(value => value.id === world)
  assert.equal(sendPlayers(playerBody(world, [player])).saved, 1)
  assert.deepEqual(readPlayers(), [player])
  const after = api.listGameMapWorlds().find(value => value.id === world)
  for (const key of ['data_id', 'source_revision', 'upload_batch', 'last_success', 'last_activity', 'tile_count']) assert.equal(after[key], before[key])
  assert.equal(after.player_count, 1)
  assert.ok(after.player_updated_at > 0)
})
check('快照重试不更改位置或刷新时间', () => {
  const before = api.listGameMapWorlds().find(value => value.id === world).player_updated_at
  assert.equal(sendPlayers(playerBody(world, [player])).saved, 0)
  assert.equal(api.listGameMapWorlds().find(value => value.id === world).player_updated_at, before)
})
const latestPlayer = { ...player, x: 128.75, y: -20.5, z: 64.25, recorded_at: playerTime + 30_000, source: 'logout' }
check('下线位置覆盖首次位置，迟到快照不能倒退', () => {
  sendPlayers(playerBody(world, [latestPlayer]))
  assert.equal(sendPlayers(playerBody(world, [player])).saved, 0)
  assert.deepEqual(readPlayers(), [latestPlayer])
})
check('同一 UUID 在不同存档独立保存', () => {
  sendPlayers(playerBody(otherWorld, [{ ...player, x: 999 }]))
  assert.equal(readPlayers()[0].x, latestPlayer.x)
  assert.equal(readPlayers(otherWorld)[0].x, 999)
})
check('未知存档、旧数据标识和未登记维度不写入任何玩家快照', () => {
  reject(() => sendPlayers(playerBody(randomUUID(), [player], randomUUID())), 409)
  reject(() => sendPlayers(playerBody(world, [player], randomUUID())), 409)
  reject(() => api.readGameMapPlayers(world, randomUUID()), 409)
  reject(() => api.readGameMapPlayers(randomUUID(), randomUUID()), 404)
  reject(() => sendPlayers(playerBody(world, [{ ...player, uuid: randomUUID() },
    { ...player, uuid: randomUUID(), dimension: 'example:missing' }])), 400)
  assert.deepEqual(readPlayers(), [latestPlayer])
})
check('玩家快照批次遇到 SQLite 异常时完整回滚', () => {
  db.exec("CREATE TRIGGER reject_player_snapshot BEFORE INSERT ON game_map_v2_players WHEN NEW.name = '测试失败' BEGIN SELECT RAISE(ABORT, '测试回滚'); END")
  assert.throws(() => sendPlayers(playerBody(world, [{ ...player, uuid: randomUUID() }, { ...player, uuid: randomUUID(), name: '测试失败' }])))
  assert.deepEqual(readPlayers(), [latestPlayer])
  db.exec('DROP TRIGGER reject_player_snapshot')
})
check('存档只保留最近 4096 位玩家快照', () => {
  const time = Date.now() - 10_000
  for (let offset = 0; offset < 4097; offset += 256) {
    sendPlayers(playerBody(world, Array.from({ length: Math.min(256, 4097 - offset) }, (_, i) => ({ ...player,
      uuid: randomUUID(), name: `玩家${offset + i}`, recorded_at: time + offset + i }))))
  }
  const rows = readPlayers()
  assert.equal(rows.length, 4096)
  assert.equal(rows[0].name, '玩家4096')
  assert.ok(!rows.some(value => value.uuid === player.uuid))
})
db.exec("INSERT INTO settings VALUES ('unrelated.setting', 'keep')")
check('确认后存档身份变化时拒绝清空并保留数据', () => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM game_map_v2_tiles').get().n
  reject(() => api.clearGameMapData(world, { [world]: randomUUID() }), 409)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_map_v2_tiles').get().n, count)
  reject(() => api.clearGameMapData(null, { [world]: previousDataId }), 409)
  assert.equal(api.listGameMapWorlds().length, 2)
})
check('清空指定存档不影响其他存档', () => {
  const reset = api.clearGameMapData(world)
  assert.equal(reset.removed_worlds, 1)
  assert.ok(reset.removed_tiles > 0)
  assert.equal(reset.removed_players, 4096)
  const worlds = api.listGameMapWorlds()
  assert.equal(worlds.length, 1)
  assert.equal(worlds[0].id, otherWorld)
  assert.equal(worlds[0].tile_count, 1)
  assert.equal(readPlayers(otherWorld).length, 1)
  for (const table of ['dimensions', 'tiles', 'layers', 'players']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM game_map_v2_${table} WHERE world_id = ?`).get(world).n, 0)
})
check('清空后拒绝在途旧上传会话和已缓存总览', () => {
  reject(() => send(raw('complete', 604, run, 1)), 409)
  reject(() => api.readGameMapOverview(view), 404)
})
check('同 UUID 重置后允许更低修订号并要求全量上传', () => {
  const reply = send(begin(1)); assert.deepEqual(reply, beginReply(true, 0))
  assert.notEqual(api.listGameMapWorlds().find(value => value.id === world).data_id, previousDataId)
  send({ ...raw('tiles', 1), tiles: [tile(-1, 1)] }); send(raw('complete', 1, run, 1))
})
check('重置后拒绝旧数据标识，也不重新补回清空前的离线位置', () => {
  reject(() => sendPlayers(playerBody(world, [latestPlayer], previousDataId)), 409)
  assert.equal(sendPlayers(playerBody(world, [latestPlayer])).saved, 0)
  assert.equal(readPlayers().length, 0)
  const fresh = { ...player, recorded_at: Date.now() + 1, source: 'upload' }
  assert.equal(sendPlayers(playerBody(world, [fresh])).saved, 1)
  assert.equal(readPlayers()[0].source, 'upload')
  assert.equal(sendPlayers(playerBody(otherWorld, [{ ...player, recorded_at: playerTime + 1 }])).saved, 1)
})
check('清空事务异常时全部回滚', () => {
  db.exec("CREATE TRIGGER reject_map_reset BEFORE UPDATE ON settings WHEN NEW.key = 'game_map.last_reset' BEGIN SELECT RAISE(ABORT, '测试回滚'); END")
  assert.throws(() => api.clearGameMapData(null))
  assert.equal(api.listGameMapWorlds().length, 2)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_map_v2_tiles').get().n, 2)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_map_v2_players').get().n, 2)
  db.exec('DROP TRIGGER reject_map_reset')
})
check('清空全部地图保留其他站点设置', () => {
  const reset = api.clearGameMapData(null)
  assert.equal(reset.removed_worlds, 2)
  assert.equal(reset.removed_tiles, 2)
  assert.equal(reset.removed_players, 2)
  for (const table of ['worlds', 'dimensions', 'tiles', 'layers', 'players']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM game_map_v2_${table}`).get().n, 0)
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'unrelated.setting'").get().value, 'keep')
  const staleId = randomUUID()
  assert.equal(api.updateGameMapResetRequest(staleId, { status: 'requested', message: '旧请求' }).id, reset.id)
  assert.equal(api.updateGameMapResetRequest(reset.id, { status: 'requested', message: '已请求上传' }).status, 'requested')
})
check('清空全部后，其他存档重新上传也不能恢复旧玩家位置', () => {
  send({ ...begin(1, randomUUID()), world_id: otherWorld })
  assert.equal(sendPlayers(playerBody(otherWorld, [player])).saved, 0)
  assert.equal(readPlayers(otherWorld).length, 0)
})
check('已有 v2 数据身份迁移可重复运行', () => {
  const old = new DatabaseSync(':memory:')
  old.exec(schema.replace("    data_id TEXT NOT NULL DEFAULT '',", ''))
  old.prepare('INSERT INTO game_map_v2_worlds (id,name,run_id,last_activity) VALUES (?,?,?,?)').run(world, '旧 v2 存档', run, 1)
  const migration = source.slice(source.indexOf('// ===== 地图数据身份迁移：'), source.indexOf('// ===== 地图数据身份迁移结束 ====='))
  const migrate = new Function('db', stripTypeScriptTypes(migration))
  migrate(old); migrate(old)
  assert.equal(old.prepare('SELECT data_id FROM game_map_v2_worlds').get().data_id, run)
  old.close()
})
db.close()
process.stdout.write(`通过 ${checks} 项地图 SQLite／协议检查。\n`)
