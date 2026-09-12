// 离线上传联动验证：执行本项目与指定 ElementsPanel 的实际源码，网络和磁盘仅在内存中模拟。
// node scripts/check-mcsm-upload.mjs --panel-source <ElementsPanel 源码目录>
// 不启动服务、不读取实际配置或数据库，也不构建项目。
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Readable } from 'node:stream'
import { setImmediate as tick } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('../', import.meta.url))
assert.equal(path.resolve(process.cwd()), path.resolve(root), '请在 YouzaiWorldApi 根目录执行')
const panelArg = process.argv.indexOf('--panel-source')
assert.ok(panelArg >= 0 && process.argv[panelArg + 1], '请通过 --panel-source 指定修改版面板源码目录')
const panelRoot = path.resolve(process.argv[panelArg + 1])
const require = createRequire(import.meta.url)
const compilerFolder = readdirSync(path.join(root, 'node_modules/.pnpm')).find(name => name.startsWith('esbuild@'))
assert.ok(compilerFolder, '需要项目已安装的 esbuild')
const esbuild = require(path.join(root, 'node_modules/.pnpm', compilerFolder, 'node_modules/esbuild'))
const http = options => Object.assign(new Error(options.statusMessage), options)
const unix = path.posix
const instanceRoot = '/memory-instance'
const uuid = 'a'.repeat(32)
const daemonId = '1'.repeat(32)
const config = { baseUrl: 'https://panel.example/panel', apiKey: 'offline-test-key' }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const files = new Map()
const descriptors = new Map()
const locks = new Set()
const missions = new Map()
const staged = new Map()
const operations = []
const requests = []
const warnings = []
let binding = uuid
let fd = 0
let beforeRequest
let afterRequest
let moveHook
let appendHook
let listHook
let maxPiece = 0
let maxSourceRead = 0
let sentPieces = 0

function evaluate(file, dependencies, globals = {}) {
  const module = { exports: {} }
  const code = esbuild.transformSync(readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', sourcefile: file }).code
  const wrapper = vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {
    console: { ...console, warn: message => warnings.push(message) },
    URL, Buffer, Uint8Array, AbortSignal, AbortController, Blob, FormData, ...globals,
  }, { filename: file })
  wrapper(spec => {
    if (Object.hasOwn(dependencies, spec)) return dependencies[spec]
    throw new Error('未隔离的模块依赖：' + spec)
  }, module, module.exports)
  return module.exports
}

const panel = (file, deps, globals) => evaluate(path.join(panelRoot, file), deps, globals)
const api = (file, deps, globals) => evaluate(path.join(root, 'server', file), deps, globals)
const missing = () => Object.assign(new Error('不存在'), { code: 'ENOENT' })
function entry(bytes = Buffer.alloc(0)) {
  return { size: bytes.length, bytes: Buffer.from(bytes), digest: createHash('sha256').update(bytes), written: bytes.length }
}
function fileInfo(target) {
  if (!files.has(target)) throw missing()
  const item = files.get(target)
  return { size: item.size, isFile: () => true, mode: 0o644, atime: new Date(0), mtimeMs: Date.now() }
}
const memoryFs = {
  existsSync: target => target === instanceRoot || target === instanceRoot + '/mods' || files.has(target),
  access: async target => { if (!files.has(target)) throw missing() },
  stat: async target => fileInfo(target),
  statSync: target => fileInfo(target),
  readdir: async directory => [...files.keys()].filter(target => unix.dirname(target) === directory)
    .map(target => ({ name: unix.basename(target), isFile: () => true })),
  open: async (target, mode) => {
    assert.equal(mode, 'w+')
    files.set(target, entry())
    descriptors.set(++fd, target)
    operations.push({ type: 'open', target })
    return fd
  },
  ftruncate: async (number, size) => {
    const item = files.get(descriptors.get(number))
    item.size = size
    item.bytes = size <= 8 * 1024 * 1024 ? Buffer.alloc(size) : null
    item.digest = createHash('sha256')
    item.written = 0
  },
  write: async (number, chunk, start, length, offset) => {
    const target = descriptors.get(number)
    const item = files.get(target)
    assert.equal(offset, item.written, '实际守护进程收到的分块必须连续')
    assert.equal(start, 0)
    assert.equal(length, chunk.length)
    item.digest.update(chunk)
    item.bytes?.set(chunk, offset)
    item.written += length
    operations.push({ type: 'write', target, offset, length })
    return { bytesWritten: length }
  },
  close: async number => { descriptors.delete(number) },
  readFile: async target => {
    const item = files.get(target)
    if (!item) throw missing()
    assert.ok(item.bytes, '大文件测试不允许把整份内容读入内存')
    return item.bytes
  },
  createFile: async target => { if (!files.has(target)) files.set(target, entry()) },
  move: async (from, to) => {
    await moveHook?.(from, to)
    if (!files.has(from)) throw missing()
    if (files.has(to)) throw Object.assign(new Error('目标已存在'), { code: 'EEXIST' })
    files.set(to, files.get(from))
    files.delete(from)
    operations.push({ type: 'move', from, to })
  },
  remove: async (target, callback) => {
    files.delete(target)
    operations.push({ type: 'remove', target })
    callback?.(null)
  },
}
const FileManager = panel('daemon/src/service/system_file.ts', {
  'fs-extra': memoryFs, path: unix, os: { platform: () => 'linux' }, 'iconv-lite': {},
  'mcsmanager-common': {}, '../common/compress': {}, '../entity/config': { globalConfiguration: { config: {} } },
  '../i18n': { $t: value => value, i18next: { language: 'en_us' } },
  '../tools/filepath': { normalizedJoin: (...parts) => unix.join(...parts) },
}).default
const manager = panel('daemon/src/service/upload_manager.ts', {
  '../entity/file_writer': {}, uuid: { v4: randomUUID },
}, { setInterval: () => 1 }).default
const FileWriter = panel('daemon/src/entity/file_writer.ts', {
  'fs-extra': memoryFs, path: unix, '../service/system_file': FileManager, '../service/upload_manager': manager,
  '../service/log': { info: () => {}, error: message => { throw new Error(String(message)) } },
  'proper-lockfile': {
    check: async target => locks.has(target), checkSync: target => locks.has(target),
    lock: async target => {
      assert.equal(locks.has(target), false)
      locks.add(target)
      return async () => { locks.delete(target) }
    },
  },
}).default
const handlers = new Map()
class Router {
  all(route, handler) { handlers.set('ALL ' + route, handler) }
  get(route, handler) { handlers.set('GET ' + route, handler) }
  post(route, handler) { handlers.set('POST ' + route, handler) }
}
const missionPassport = {
  getMission: (key, type) => missions.get(key)?.type === type ? missions.get(key) : undefined,
  deleteMission: key => missions.delete(key),
}
const instance = { absoluteCwdPath: () => instanceRoot, status: () => 3, info: { fileLock: 0 } }
const subsystem = { getInstance: id => id === uuid ? instance : null }
panel('daemon/src/routers/http_router.ts', {
  '@koa/router': Router, formidable: {}, 'fs-extra': memoryFs, path: unix,
  '../const/index_html': { DAEMON_INDEX_HTML: '' }, '../entity/file_writer': FileWriter,
  '../i18n': { $t: value => value }, '../service/mission_passport': { missionPassport },
  '../service/system_file': FileManager, '../service/system_instance': subsystem,
  '../service/upload_manager': manager, '../tools/filepath': {
    clearUploadFiles: parts => { for (const part of Array.isArray(parts) ? parts : [parts]) files.delete(part.filepath) },
  },
  '../utils/speed_limit': {},
})
const precheck = panel('daemon/src/middlewares/precheck.ts', {
  '../entity/config': { globalConfiguration: { config: {} } }, '../service/log': { error: () => {} },
  '../service/mission_passport': { missionPassport }, '../service/upload_manager': manager, '../utils/speed_limit': {},
}).uploadFileCheckMiddleware
const fileHandlers = new Map()
panel('daemon/src/routers/file_router.ts', {
  i18next: { t: value => value }, os: { platform: () => 'linux' },
  '../entity/config': { globalConfiguration: { config: {} }, globalEnv: {} },
  '../entity/instance/instance': { STATUS_BUSY: -1, STATUS_STARTING: 2 },
  '../i18n': { $t: value => value }, '../service/download_manager': {},
  '../service/file_router_service': { getFileManager: () => new FileManager(instanceRoot, 'utf-8') },
  '../service/log': {},
  '../service/protocol': {
    response: (ctx, result) => { ctx.result = result },
    responseError: (ctx, error) => { ctx.error = error },
  },
  '../service/router': { routerApp: { use: () => {}, on: (name, handler) => fileHandlers.set(name, handler) } },
  '../service/system_instance': subsystem, '../service/upload_manager': manager, '../utils/url': {},
})

const guard = () => {
  if (binding !== uuid) throw http({ statusCode: 409, statusMessage: '管理实例已变更' })
}
const callPanel = async (endpoint, options = {}) => {
  assert.equal(options.query.uuid, uuid)
  assert.equal(options.query.daemonId, daemonId)
  if (endpoint === '/api/files/upload') {
    const ticket = randomUUID()
    missions.set(ticket, { type: 'upload', parameter: { instanceUuid: uuid, uploadDir: options.query.upload_dir } })
    return { password: ticket, addr: 'ws://node.internal:24444', remoteMappings: [
      { from: { addr: 'panel.example:443', prefix: '/panel' }, to: { addr: 'http://node.example:24444', prefix: '/edge' } },
    ] }
  }
  const ctx = {}
  const common = { instanceUuid: uuid, ...options.body }
  if (endpoint === '/api/files/list') {
    const overridden = await listHook?.(options.query)
    if (overridden) return overridden
    await fileHandlers.get('file/list')(ctx, { ...common, page: Number(options.query.page),
      pageSize: Number(options.query.page_size), target: options.query.target, fileName: options.query.file_name })
  } else if (endpoint === '/api/files/move') {
    await fileHandlers.get('file/move')(ctx, common)
  } else if (endpoint === '/api/files/touch') {
    await fileHandlers.get('file/touch')(ctx, common)
  } else if (endpoint === '/api/files/' && options.method === 'DELETE') {
    await fileHandlers.get('file/delete')(ctx, common)
  } else throw new Error('未隔离的面板操作：' + endpoint)
  if (ctx.error) throw http({ statusCode: 502, statusMessage: ctx.error.message })
  return ctx.result
}
const daemonFetch = async (target, options) => {
  const url = new URL(target)
  assert.equal(url.origin, 'http://node.example:24444')
  assert.ok(url.pathname.startsWith('/edge/'))
  options.signal?.throwIfAborted()
  requests.push({ url, method: options.method })
  const override = await beforeRequest?.(url, options)
  if (override) return override
  const stop = url.searchParams.has('stop')
  const isPiece = url.pathname.includes('/upload-piece/')
  const ctx = {
    origin: url.origin, url: url.pathname + url.search, status: 200, body: undefined,
    params: { key: url.pathname.split('/').at(-1), id: url.pathname.split('/').at(-1) },
    query: Object.fromEntries(url.searchParams), request: { headers: {} },
  }
  if (isPiece) {
    assert.ok(options.body instanceof FormData)
    const request = new Request(url, { method: 'POST', body: options.body })
    const bytes = Buffer.from(await request.arrayBuffer())
    assert.ok(bytes.length < 100 * 1024 * 1024, '单个 multipart 必须低于面板的限制')
    const form = await new Response(bytes, { headers: request.headers }).formData()
    assert.deepEqual([...form.keys()], ['file'])
    const part = form.get('file')
    maxPiece = Math.max(maxPiece, part.size)
    assert.ok(part.size > 0 && part.size <= 2 * 1024 * 1024)
    const temporary = '/multipart-' + randomUUID()
    files.set(temporary, entry(Buffer.from(await part.arrayBuffer())))
    ctx.request.headers['content-type'] = request.headers.get('content-type')
    ctx.request.files = { file: { originalFilename: part.name, filepath: temporary } }
    sentPieces++
  } else {
    assert.equal(options.body, undefined)
    if (!stop) assert.equal(url.searchParams.get('overwrite'), 'false')
  }
  const handler = handlers.get(isPiece ? 'POST /upload-piece/:id' : 'POST /upload-new/:key')
  await precheck(ctx, () => handler(ctx))
  const changed = await afterRequest?.(url, ctx, options)
  if (changed) return changed
  return new Response(typeof ctx.body === 'string' ? ctx.body : JSON.stringify(ctx.body), { status: ctx.status })
}
const sharedDeps = { h3: { createError: http } }
const address = api('utils/mcsm-daemon.ts', sharedDeps)
const mcsmDeps = { callPanel, createManagedInstanceGuard: () => { guard(); return guard },
  assertManagedInstanceAllowed: async () => { guard(); return { nickname: '内存测试实例' } } }
const dbDeps = { getAdminMcsmConfig: () => config, getMcsmConfig: () => config,
  requireFeaturePermission: event => {
    if (event.denied) throw http({ statusCode: 403, statusMessage: '无权限' })
    return { id: 1 }
  }, recordAudit: () => {} }
const fileApi = api('utils/mcsm-files.ts', {
  ...sharedDeps, './mcsm': mcsmDeps, './db': dbDeps, './mcsm-daemon': address,
})
const transport = api('utils/mcsm-upload.ts', {
  ...sharedDeps, 'node:fs': {
    createReadStream: target => {
      const item = staged.get(target)
      if (!item) return Readable.from((async function* () { throw missing() })())
      return item.generate ? Readable.from(item.generate()) : Readable.from([item])
    },
  },
}, { fetch: daemonFetch })
const uploader = api('utils/mcsm-upload-target.ts', {
  ...sharedDeps, 'node:crypto': { createHash, randomUUID }, 'node:timers/promises': require('node:timers/promises'),
  './db': dbDeps, './mcsm': mcsmDeps, './mcsm-files': fileApi, './mcsm-upload': transport,
})
const chunkRoute = api('api/admin/mcsm/files/upload-chunk.put.ts', {
  'node:crypto': { createHash }, 'node:path': path,
  'node:fs/promises': {
    mkdir: async () => {}, readdir: async () => [],
    stat: async target => { if (!staged.has(target)) throw missing(); return { size: staged.get(target).length } },
    appendFile: async (target, bytes, options) => {
      await appendHook?.(target, bytes)
      if (options.flag === 'wx' && staged.has(target)) throw Object.assign(new Error('已存在'), { code: 'EEXIST' })
      staged.set(target, Buffer.concat([staged.get(target) || Buffer.alloc(0), bytes]))
    },
    rm: async target => { staged.delete(target) },
  },
  '../../../../utils/db': dbDeps, '../../../../utils/data-dir': { dataDir: '/configured-test-data' },
  '../../../../utils/mcsm': mcsmDeps, '../../../../utils/mcsm-files': fileApi,
  '../../../../utils/mcsm-upload': transport, '../../../../utils/mcsm-upload-target': uploader,
}, {
  createError: http, defineEventHandler: handler => handler, getQuery: event => event.query,
  getHeader: (event, name) => event.headers?.[name],
}).default

const control = () => ({ assertCurrent: guard, signal: new AbortController().signal })
const rejectStatus = (run, status) => assert.rejects(run, error => error.statusCode === status)
const settle = async () => { for (let index = 0; index < 4; index++) await tick() }
const pendingTasks = () => [...manager.getUploads()]
async function reset() {
  await settle()
  for (const [, writer] of pendingTasks()) await writer.stop()
  files.clear(); descriptors.clear(); locks.clear(); missions.clear(); staged.clear()
  operations.length = 0; requests.length = 0; warnings.length = 0
  binding = uuid; beforeRequest = afterRequest = moveHook = appendHook = listHook = undefined
  maxPiece = maxSourceRead = sentPieces = 0
}
async function check(name, run) {
  await reset()
  await run()
  await settle()
  assert.equal(descriptors.size, 0, '未关闭的守护进程文件句柄')
  assert.equal(locks.size, 0, '未释放的上传锁')
  console.log('通过：' + name)
}
function chunkEvent(content, { total = content.length, offset = 0, id = randomUUID(), name = '报告.txt', final = true, headers, overwrite = '0' } = {}) {
  return { query: { uuid, daemonId, path: '/mods', name, uploadId: id, offset, total, final: final ? '1' : '0', overwrite },
    headers: headers ?? { 'content-length': String(content.length) },
    node: { req: Readable.from(content.length ? [content] : []), res: Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false }) } }
}
async function uploadBytes(bytes, name = '报告.txt', overwrite = false) {
  const id = randomUUID()
  let result
  for (let offset = 0; offset < bytes.length || (bytes.length === 0 && offset === 0); offset += 128 * 1024) {
    const end = Math.min(bytes.length, offset + 128 * 1024)
    result = await chunkRoute(chunkEvent(bytes.subarray(offset, end), {
      total: bytes.length, offset, id, name, final: end === bytes.length, headers: {}, overwrite: overwrite ? '1' : '0',
    }))
    if (bytes.length === 0) break
  }
  return result
}
const finalPath = name => instanceRoot + '/mods/' + name
const assertNoTemporary = () => assert.equal([...files.keys()].some(name => name.includes('.yzw-upload-')), false)

await check('节点地址、ws/wss、显式协议、IPv6、前缀和远程地址映射', async () => {
  const resolve = address.resolveDaemonBase
  const cases = [
    ['ws://node.example:24444', 'https://panel.example', 'http://node.example:24444'],
    ['wss://node.example/edge/', 'http://panel.example', 'https://node.example/edge'],
    ['http://node.example:24444', 'https://panel.example', 'http://node.example:24444'],
    ['node.example:24444', 'https://panel.example', 'https://node.example:24444'],
    ['ws://127.0.0.1:24444/edge', 'https://panel.example', 'http://panel.example:24444/edge'],
    ['ws://[::1]:24444', 'http://[2001:db8::1]', 'http://[2001:db8::1]:24444'],
    ['http://[2001:db8::2]:24444/path', 'https://panel.example', 'http://[2001:db8::2]:24444/path'],
  ]
  for (const [addr, panelBase, expected] of cases) assert.equal(resolve({ addr }, panelBase), expected)
  assert.equal(resolve({ addr: 'wss://node.example/edge', prefix: '/edge/' }, config.baseUrl), 'https://node.example/edge')
  assert.equal(resolve({ addr: 'ws://private:24444', remoteMappings: [
    { from: { addr: 'panel.example:443', prefix: '/panel/' }, to: { addr: 'ws://public:80', prefix: '/node' } },
  ] }, config.baseUrl), 'http://public/node')
  for (const addr of ['', 'ftp://node.example', 'http://user:pass@node.example', 'node.example?key=secret', 'node.example\\path', 'node.example/\n']) {
    assert.throws(() => resolve({ addr }, config.baseUrl), error => error.statusCode === 502)
  }
})
await check('修改版面板实际目录分页：146 项全部读取，空目录、整页边界与显式单页读取', async () => {
  for (const count of [0, 100, 146, 200, 301]) {
    files.clear()
    const names = Array.from({ length: count }, (_, index) => `mod-${String(index).padStart(3, '0')}.jar`)
    for (const name of names) files.set(finalPath(name), entry(Buffer.from(name)))
    const pages = []
    listHook = async query => {
      assert.equal(query.page_size, 100)
      pages.push(query.page)
      // 不替换响应，由修改版面板的 file/list 和 FileManager.list 实际执行分页。
    }
    const result = await fileApi.listAllFiles(uuid, daemonId, '/mods')
    assert.equal(result.path, '/mods')
    assert.equal(result.total, count)
    assert.equal(result.items.length, count)
    assert.deepEqual(Array.from(result.items, item => item.name), names)
    assert.deepEqual(pages, Array.from({ length: Math.max(1, Math.ceil(count / 100)) }, (_, page) => page))
    if (count === 146) {
      pages.length = 0
      const second = await fileApi.listFiles(uuid, daemonId, '/mods', 1)
      assert.equal(second.items.length, 46)
      assert.equal(second.page, 1)
      assert.equal(second.pageSize, 100)
      assert.deepEqual(Array.from(second.items, item => item.name), names.slice(100))
      assert.deepEqual(pages, [1])
    }
    assert.equal(files.size, count, '目录读取不能增删任何文件')
    assert.equal(operations.length, 0)
  }
})
await check('完整链路：无长度头、中文特殊文件名、128 KiB 收块与 2 MiB 节点分块、哈希校验', async () => {
  const name = '中文 + #&%.txt'
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 17, 0x5a)
  const result = await uploadBytes(bytes, name)
  assert.equal(result.complete, true)
  assert.equal(result.path, '/mods/' + name)
  assert.equal(files.get(finalPath(name)).digest.copy().digest('hex'), hash(bytes))
  assert.equal(maxPiece, 2 * 1024 * 1024)
  assert.equal(sentPieces, 2)
  assert.equal(staged.size, 0)
  assertNoTemporary()
})
await check('空文件使用面板新建接口，核对落盘，不创建永远无法结束的上传任务', async () => {
  await uploadBytes(Buffer.alloc(0), 'empty.txt')
  assert.equal(files.get(finalPath('empty.txt')).size, 0)
  assert.equal(requests.length, 0)
  assert.equal(pendingTasks().length, 0)
  assertNoTemporary()
})
await check('超过旧 100 MiB 上限的文件逐块上传，源读取与 multipart 均保持有界', async () => {
  const size = 104 * 1024 * 1024 + 17
  const expected = createHash('sha256')
  staged.set('large-source', { generate: async function* () {
    for (let offset = 0; offset < size; offset += 64 * 1024) {
      const bytes = Buffer.alloc(Math.min(size - offset, 64 * 1024), 0x31)
      maxSourceRead = Math.max(maxSourceRead, bytes.length)
      expected.update(bytes)
      yield bytes
    }
  } })
  await uploader.uploadStagedFile(uuid, daemonId, '/mods', 'large.jar', 'large-source', size, control())
  const actual = files.get(finalPath('large.jar'))
  assert.equal(actual.size, size)
  assert.equal(actual.written, size)
  assert.equal(actual.digest.copy().digest('hex'), expected.digest('hex'))
  assert.equal(sentPieces, Math.ceil(size / (2 * 1024 * 1024)))
  assert.equal(maxSourceRead, 64 * 1024)
  assertNoTemporary()
})
await check('同名替换在完整上传后才触及旧文件，成功后清理备份', async () => {
  const previous = Buffer.from('原始文件内容')
  files.set(finalPath('报告.txt'), entry(previous))
  beforeRequest = async url => {
    if (url.pathname.includes('upload-piece')) assert.deepEqual(files.get(finalPath('报告.txt')).bytes, previous)
  }
  await uploadBytes(Buffer.alloc(2 * 1024 * 1024 + 1, 0x32), '报告.txt', true)
  assert.equal(files.get(finalPath('报告.txt')).size, 2 * 1024 * 1024 + 1)
  assertNoTemporary()
})
await check('节点空 ACK 不算成功；只取消自己的未完成任务，旧文件保持不变', async () => {
  const previous = Buffer.from('不能丢失')
  files.set(finalPath('报告.txt'), entry(previous))
  afterRequest = async url => url.pathname.includes('upload-piece') ? new Response('') : undefined
  await rejectStatus(() => uploadBytes(Buffer.alloc(2 * 1024 * 1024 + 1), '报告.txt', true), 502)
  assert.deepEqual(files.get(finalPath('报告.txt')).bytes, previous)
  assert.equal(requests.filter(item => item.url.searchParams.has('stop')).length, 1)
  assert.equal(staged.size, 0)
  assertNoTemporary()
})
await check('转发期间绑定切换会停止后续块，只使用原任务地址清理', async () => {
  afterRequest = async url => { if (url.pathname.includes('upload-piece')) binding = 'b'.repeat(32) }
  await rejectStatus(() => uploadBytes(Buffer.alloc(4 * 1024 * 1024)), 409)
  assert.equal(sentPieces, 1)
  assert.equal(requests.filter(item => item.url.searchParams.has('stop')).length, 1)
  assert.equal(files.has(finalPath('报告.txt')), false)
  assertNoTemporary()
})
await check('浏览器在收块完成后断开响应，也会取消节点上传', async () => {
  const bytes = Buffer.alloc(3 * 1024 * 1024)
  const id = randomUUID()
  for (let offset = 0; offset < bytes.length - 128 * 1024; offset += 128 * 1024) {
    await chunkRoute(chunkEvent(bytes.subarray(offset, offset + 128 * 1024), { id, offset, total: bytes.length, final: false }))
  }
  const last = chunkEvent(bytes.subarray(bytes.length - 128 * 1024), { id, offset: bytes.length - 128 * 1024, total: bytes.length })
  afterRequest = async url => { if (url.pathname.includes('upload-piece')) last.node.res.emit('close') }
  await rejectStatus(() => chunkRoute(last), 499)
  assert.equal(sentPieces, 1)
  assert.equal(staged.size, 0)
  assertNoTemporary()
})
await check('正常请求流 close 不等于浏览器断开；成功 ACK 后不 stop 已完成任务', async () => {
  const event = chunkEvent(Buffer.from('abc'))
  beforeRequest = async () => { event.node.req.emit('close') }
  assert.equal((await chunkRoute(event)).complete, true)
  assert.equal(requests.some(item => item.url.searchParams.has('stop')), false)
  assert.equal(event.node.res.listenerCount('close'), 0)
})
await check('发布失败时恢复原文件，不能用失败清理删除旧内容', async () => {
  const previous = Buffer.from('旧文件')
  files.set(finalPath('报告.txt'), entry(previous))
  moveHook = async (from, to) => {
    if (from.endsWith('.part') && to === finalPath('报告.txt')) throw new Error('模拟文件占用')
  }
  await rejectStatus(() => uploadBytes(Buffer.from('新文件'), '报告.txt', true), 502)
  assert.deepEqual(files.get(finalPath('报告.txt')).bytes, previous)
  assertNoTemporary()
})
await check('恢复也失败时保留原文件备份并返回可恢复路径', async () => {
  const previous = Buffer.from('待恢复的旧文件')
  files.set(finalPath('报告.txt'), entry(previous))
  moveHook = async (from, to) => {
    if ((from.endsWith('.part') || from.endsWith('.previous')) && to === finalPath('报告.txt')) throw new Error('模拟移动失败')
  }
  await assert.rejects(() => uploadBytes(Buffer.from('新文件'), '报告.txt', true), error => error.statusMessage.includes('.previous'))
  const backup = [...files.keys()].find(name => name.endsWith('.previous'))
  assert.ok(backup)
  assert.deepEqual(files.get(backup).bytes, previous)
})
await check('来源大小不符、空来源与读取异常不能发布不完整文件', async () => {
  for (const bytes of [Buffer.from('ab'), Buffer.from('abcd')]) {
    staged.set('wrong-source', bytes)
    await rejectStatus(() => uploader.uploadStagedFile(uuid, daemonId, '/mods', 'wrong.txt', 'wrong-source', 3, control()), 400)
    assert.equal(files.has(finalPath('wrong.txt')), false)
    assertNoTemporary()
  }
  const { url } = await fileApi.fileUploadUrl(uuid, daemonId, '/mods')
  await rejectStatus(() => transport.forwardFileUpload(url, Readable.from([]), 0, 'empty.part', control()), 400)
  await assert.rejects(() => uploader.uploadStagedFile(uuid, daemonId, '/mods', 'missing.txt', 'missing', 3, control()))
  assertNoTemporary()
})
await check('拒绝接续已有内容的任务，不停止或删除来源不明的上传', async () => {
  const original = new FileWriter(instanceRoot, 'occupied.part', 3, false, '', finalPath('occupied.part'))
  await original.init()
  const id = manager.add(original)
  await original.write(0, Buffer.from('a'))
  const { url } = await fileApi.fileUploadUrl(uuid, daemonId, '/mods')
  await rejectStatus(() => transport.forwardFileUpload(url, Readable.from([Buffer.from('xyz')]), 3, 'occupied.part', control()), 409)
  assert.equal(manager.get(id), original)
  assert.equal(files.get(finalPath('occupied.part')).written, 1)
  assert.equal(requests.some(item => item.url.searchParams.has('stop')), false)
  await original.stop()
})
await check('收块权限、声明与实际体积、顺序及数据目录权限校验', async () => {
  const denied = chunkEvent(Buffer.from('abc')); denied.denied = true
  await rejectStatus(() => chunkRoute(denied), 403)
  await rejectStatus(() => chunkRoute(chunkEvent(Buffer.from('abc'), { offset: 1, total: 4 })), 409)
  await rejectStatus(() => chunkRoute(chunkEvent(Buffer.from('abc'), { headers: { 'content-length': '1' } })), 400)
  await rejectStatus(() => chunkRoute(chunkEvent(Buffer.alloc(128 * 1024 + 1), { headers: {} })), 413)
  await rejectStatus(() => chunkRoute(chunkEvent(Buffer.alloc(0), { total: 1, final: false })), 400)
  appendHook = async target => {
    assert.equal(path.dirname(target), path.join('/configured-test-data', 'upload-staging'))
    throw Object.assign(new Error('模拟权限错误'), { code: 'EACCES' })
  }
  await rejectStatus(() => chunkRoute(chunkEvent(Buffer.from('abc'))), 500)
  assert.equal(requests.length, 0)
  assert.equal(staged.size, 0)
})
await check('同一收块会话和同一目标路径的并发上传被阻止', async () => {
  let entered
  let release
  const started = new Promise(resolve => { entered = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  appendHook = async () => { entered(); await blocked }
  const event = chunkEvent(Buffer.from('abc'))
  const pending = chunkRoute(event)
  await started
  const duplicate = chunkEvent(Buffer.from('abc'), { id: event.query.uploadId })
  await rejectStatus(() => chunkRoute(duplicate), 409)
  release()
  await pending
  appendHook = undefined
  let uploadEntered
  let uploadRelease
  const transferring = new Promise(resolve => { uploadEntered = resolve })
  const transferBlocked = new Promise(resolve => { uploadRelease = resolve })
  beforeRequest = async () => { uploadEntered(); await transferBlocked }
  staged.set('concurrent', Buffer.from('xyz'))
  const first = uploader.uploadStagedFile(uuid, daemonId, '/mods', 'same.txt', 'concurrent', 3, control())
  await transferring
  await rejectStatus(() => uploader.uploadStagedFile(uuid, daemonId, '/mods', 'same.txt', 'concurrent', 3, control()), 409)
  uploadRelease()
  await first
  assertNoTemporary()
})
await check('未确认替换时拒绝覆盖，改名上传保留原文件，空文件也不能绕过确认', async () => {
  const previous = Buffer.from('必须保留的原文件')
  files.set(finalPath('报告.txt'), entry(previous))
  const checked = await uploader.inspectUploadTarget(uuid, daemonId, '/mods', '报告.txt', control())
  assert.equal(checked.existing.size, previous.length)
  assert.equal(checked.existing.name, '报告.txt')
  for (const bytes of [Buffer.from('new'), Buffer.alloc(0)]) {
    await assert.rejects(() => uploadBytes(bytes), error => error.statusCode === 409 && error.data?.code === 'MCSM_UPLOAD_CONFLICT')
  }
  assert.equal(requests.length, 0, '明确冲突时不创建节点任务')
  assert.deepEqual(files.get(finalPath('报告.txt')).bytes, previous)
  await uploadBytes(Buffer.from('new'), '报告 (1).txt')
  assert.deepEqual(files.get(finalPath('报告.txt')).bytes, previous)
  assert.equal(files.get(finalPath('报告 (1).txt')).bytes.toString(), 'new')
  assert.equal(staged.size, 0)
  assertNoTemporary()
})
await check('目标目录分页、大小写冲突与目录占用检查', async () => {
  let queriedPages = []
  listHook = async query => {
    queriedPages.push(query.page)
    return { items: query.page === 0 ? [{ name: 'REPORT.TXT', type: 1, size: 10 }] : [{ name: 'report.txt', type: 1, size: 3 }],
      total: 101, pageSize: 100 }
  }
  assert.equal((await uploader.inspectUploadTarget(uuid, daemonId, '/mods', 'report.txt', control())).existing.name, 'report.txt')
  assert.deepEqual(queriedPages, [0, 1])
  listHook = async () => ({ items: [{ name: 'REPORT.TXT', type: 1, size: 10 }], total: 1, pageSize: 100 })
  assert.equal((await uploader.inspectUploadTarget(uuid, daemonId, '/mods', 'report.txt', control())).existing.name, 'REPORT.TXT')
  await rejectStatus(() => uploadBytes(Buffer.from('new'), 'report.txt', true), 409)
  listHook = async () => ({ items: [{ name: '报告.txt', type: 0, size: 0 }], total: 1, pageSize: 100 })
  await rejectStatus(() => uploadBytes(Buffer.from('new'), '报告.txt', true), 409)
  assert.equal(requests.length, 0)
})
await check('上传期间新出现的同名文件不会被覆盖，最后移动的竞态也要求重新确认', async () => {
  const concurrent = Buffer.from('其他人的文件')
  afterRequest = async url => {
    if (url.pathname.includes('upload-piece')) files.set(finalPath('报告.txt'), entry(concurrent))
  }
  await assert.rejects(() => uploadBytes(Buffer.from('new')), error => error.data?.code === 'MCSM_UPLOAD_CONFLICT')
  assert.deepEqual(files.get(finalPath('报告.txt')).bytes, concurrent)
  assertNoTemporary()
  files.delete(finalPath('报告.txt'))
  afterRequest = undefined
  moveHook = async (from, to) => {
    if (from.endsWith('.part') && to === finalPath('报告.txt')) files.set(to, entry(concurrent))
  }
  await assert.rejects(() => uploadBytes(Buffer.from('new')), error => error.data?.code === 'MCSM_UPLOAD_CONFLICT')
  assert.deepEqual(files.get(finalPath('报告.txt')).bytes, concurrent)
  assertNoTemporary()
})
await check('替换选项严格校验，上传途中不能切换覆盖许可', async () => {
  await rejectStatus(() => chunkRoute(chunkEvent(Buffer.from('a'), { overwrite: 'true' })), 400)
  const id = randomUUID()
  await chunkRoute(chunkEvent(Buffer.from('a'), { id, total: 2, final: false }))
  await rejectStatus(() => chunkRoute(chunkEvent(Buffer.from('b'), { id, total: 2, offset: 1, overwrite: '1' })), 409)
  await chunkRoute(chunkEvent(Buffer.from('b'), { id, total: 2, offset: 1 }))
  assert.equal(files.get(finalPath('报告.txt')).bytes.toString(), 'ab')
  assertNoTemporary()
})
await reset()
console.log('全部上传联动检查通过；未启动服务，未外呼网络，未改动真实数据库或服务器文件。')
