// 离线验证：SQLite 仅使用内存数据库，所有面板请求均由本地模拟响应处理。
// 在项目根目录执行 node scripts/check-mcsm-managed-instance.mjs，不启动 Nuxt 或 Minecraft。
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('../', import.meta.url))
assert.equal(path.resolve(process.cwd()), path.resolve(root), '请在 YouzaiWorldApi 项目根目录执行')
const require = createRequire(import.meta.url)
const compiler = require('vue/compiler-sfc')
const vue = require('vue')
const esbuildFolder = readdirSync(path.join(root, 'node_modules/.pnpm')).find(name => name.startsWith('esbuild@'))
assert.ok(esbuildFolder, '需要项目已安装的 esbuild 依赖')
const esbuild = require(path.join(root, 'node_modules/.pnpm', esbuildFolder, 'node_modules/esbuild'))
const source = file => readFileSync(path.join(root, file), 'utf8')
const transpile = (text, file) => esbuild.transformSync(text, { loader: 'ts', format: 'cjs', sourcefile: file }).code
const error = options => Object.assign(new Error(options.statusMessage), options)
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message)
const targetA = { instanceUuid: 'a'.repeat(32), daemonId: '1'.repeat(32) }
const targetB = { instanceUuid: 'b'.repeat(32), daemonId: '2'.repeat(32) }
const editor = { permissions: { 'settings-mcsm': 'edit', 'server-manage': 'view', 'server-manage-power': 'edit' } }
const readonly = { permissions: { 'settings-mcsm': 'view' } }
const panelCalls = []
const panelRequests = []
const audits = []
const databases = []
const cleanup = []
let panelHook
let browserFetch = async () => { throw new Error('未设置页面请求模拟') }
const browserRoute = vue.reactive({ query: {} })
const browserPermissions = vue.ref(null)
const toasts = []
const summary = target => ({ ...target, nickname: target.instanceUuid[0], status: 3, info: {} })

function permission(event, key, level) {
  const actual = event.permissions?.[key]
  if (actual !== 'edit' && actual !== level) throw error({ statusCode: 403, statusMessage: '无权限' })
  return { id: event.userId || 1 }
}

// 每个测试模块执行实际源码，唯独数据库路径、外呼和页面生命周期替换为隔离环境。
const modules = new Map()
let db
const context = vm.createContext({
  console, Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, AbortSignal, AbortController,
  process: { env: { NODE_ENV: 'test', YZWC_MOJANG_DISABLED: '1' }, cwd: () => root },
  createError: error,
  defineEventHandler: handler => handler,
  readBody: async event => event.body,
  getQuery: event => event.query || {},
  getHeader: (event, name) => event.headers?.[name],
  setResponseHeader: () => {},
  useHead: () => {},
  useToast: () => ({ showToast: (...args) => toasts.push(args) }),
  useRoute: () => browserRoute,
  useDialogAnimation: () => ({ apply: () => {} }),
  useAdminAccess: () => ({
    levelForKey: key => browserPermissions.value ? browserPermissions.value[key] || 'hidden' : 'edit',
    featureLevelForKey: key => browserPermissions.value ? browserPermissions.value[key] || 'hidden' : 'edit',
    user: vue.ref({ isOwner: true }), updateProfile: () => {},
  }),
  useEntry: () => ({ entry: vue.ref('') }),
  usePasswordPolicy: () => ({ apply: () => {} }),
  navigateTo: () => {},
  nextTick: vue.nextTick,
  document: { hidden: false },
  requestAnimationFrame: callback => callback(),
  setTimeout: () => 1, clearTimeout: () => {},
  setInterval: () => 1, clearInterval: () => {},
  $fetch: (...args) => browserFetch(...args),
  fetch: async (url, options) => {
    const request = new URL(url)
    panelCalls.push(request)
    panelRequests.push({ url: request, options })
    const response = await panelHook?.(request, options)
    if (response instanceof Response) return response
    const data = request.pathname === '/api/protected_instance/outputlog'
      ? '\u001b[32m服务器日志\u001b[0m\r\n'
      : { userName: '测试面板用户', permission: 1,
        apiKey: '不应出现在实例列表中的密钥', instances: [summary(targetA), summary(targetB)] }
    return new Response(JSON.stringify({ status: 200, data }))
  },
})
const sources = []
context.EventSource = class {
  listeners = new Map()
  closed = false
  constructor(url) { this.url = url; sources.push(this) }
  addEventListener(name, handler) { this.listeners.set(name, handler) }
  emit(name, payload) { this.listeners.get(name)?.({ data: JSON.stringify(payload) }) }
  close() { this.closed = true }
}

function load(file, overrideSource) {
  const absolute = path.resolve(root, file)
  if (modules.has(absolute)) return modules.get(absolute).exports
  const module = { exports: {} }
  modules.set(absolute, module)
  const localRequire = spec => {
    if (spec === 'node:sqlite') return {
      DatabaseSync: class {
        constructor() { const connection = new DatabaseSync(':memory:'); databases.push(connection); return connection }
      },
    }
    if (spec === 'node:fs') return { promises: new Proxy({}, { get: () => () => { throw new Error('测试禁止文件写入') } }) }
    if (spec === 'h3') return { createError: error, getCookie: () => undefined, getHeader: () => undefined }
    if (spec === 'vue') return {
      ...vue,
      onMounted: () => {},
      onBeforeUnmount: callback => cleanup.push(callback),
      watch: (...args) => { const stop = vue.watch(...args); cleanup.push(stop); return stop },
    }
    if (spec.startsWith('node:')) return require(spec)
    let dependency
    if (spec.startsWith('#shared/')) dependency = path.join(root, 'shared', spec.slice(8) + '.ts')
    else if (spec.startsWith('.')) dependency = path.resolve(path.dirname(absolute), spec) + '.ts'
    else throw new Error('未模拟的依赖：' + spec)
    if (dependency === path.join(root, 'server/utils/data-dir.ts')) {
      return { dataDir: '/unused-mcsm-check', ensureDataDirs: () => {} }
    }
    if (dependency === path.join(root, 'server/utils/db.ts') && absolute.includes(path.join('server', 'api'))) {
      return { ...db, requireFeaturePermission: permission, requirePagePermission: permission,
        recordAudit: (_event, _user, text) => audits.push(text) }
    }
    return load(path.relative(root, dependency))
  }
  const wrapper = vm.runInContext('(function(require,module,exports){' + transpile(overrideSource ?? source(file), file) + '\n})', context, { filename: file })
  wrapper(localRequire, module, module.exports)
  return module.exports
}

function compilePage(file, props = {}, emitted = []) {
  const parsed = compiler.parse(source(file), { filename: file })
  assert.deepEqual(parsed.errors, [])
  const script = compiler.compileScript(parsed.descriptor, { id: file })
  const template = compiler.compileTemplate({
    source: parsed.descriptor.template.content, filename: file, id: file,
    compilerOptions: { isCustomElement: tag => tag.startsWith('md-'), bindingMetadata: script.bindings, expressionPlugins: ['typescript'] },
  })
  assert.deepEqual(template.errors, [])
  for (const style of parsed.descriptor.styles) {
    assert.deepEqual(compiler.compileStyle({ source: style.content, filename: file, id: 'data-v-check', scoped: style.scoped }).errors, [])
  }
  return load(file, script.content).default.setup(props, { expose: () => {}, emit: (...args) => emitted.push(args) })
}

async function rejectsStatus(action, statusCode) {
  await assert.rejects(action, caught => caught.statusCode === statusCode)
}

try {
  db = load('server/utils/db.ts')
  const shared = load('shared/mcsm-instance.ts')
  const mcsm = load('server/utils/mcsm.ts')
  const select = load('server/api/admin/mcsm-settings/instance.patch.ts').default
  const options = load('server/api/admin/mcsm-settings/instances.get.ts').default
  const instance = load('server/api/admin/mcsm/instance.get.ts').default
  const power = load('server/api/admin/mcsm/power.post.ts').default
  const command = load('server/api/admin/mcsm/command.post.ts').default
  const log = load('server/api/admin/mcsm/log.get.ts').default
  const mapping = load('shared/admin-api-permissions.ts')
  const save = (target, event = editor) => select({ ...event, body: { managedInstance: target } })

  same(await instance(editor), { configured: false, instanceConfigured: false, instance: null })
  db.setMcsmConfig({ baseUrl: 'https://panel.example', apiKey: 'test_key_1234567890' })
  same(await instance(editor), { configured: true, instanceConfigured: false, instance: null })
  assert.equal(panelCalls.length, 0, '未绑定时不自动查询或操作第一个实例')
  for (const invalid of [undefined, {}, [], { instanceUuid: targetA.instanceUuid }, { ...targetA, daemonId: '../node' }]) {
    await rejectsStatus(() => save(invalid), 400)
    assert.equal(db.getMcsmManagedInstance(), null)
  }
  same(shared.normalizeMcsmInstanceTarget({ instanceUuid: 'B'.repeat(32), daemonId: targetB.daemonId }), targetB)
  await rejectsStatus(() => save(targetB, readonly), 403)
  await save(targetB)
  same(db.getMcsmManagedInstance(), targetB)
  same(db.getAdminMcsmConfig().managedInstance, targetB)
  assert.equal((await instance({ ...editor, query: targetA })).instance.instanceUuid, targetB.instanceUuid)
  const list = await options(readonly)
  assert.equal(list.instances.length, 2)
  assert.ok(!JSON.stringify(list).includes('不应出现在实例列表中的密钥'))
  console.log('通过：实例保存、回读、未配置状态、输入校验和设置权限')

  const beforeWrongTarget = panelCalls.length
  await rejectsStatus(() => power({ ...editor, body: { uuid: targetA.instanceUuid, daemonId: targetA.daemonId, action: 'open' } }), 409)
  assert.equal(panelCalls.length, beforeWrongTarget, '错误管理目标必须在面板外呼前拒绝')
  await power({ ...editor, body: { uuid: targetB.instanceUuid, daemonId: targetB.daemonId, action: 'open' } })
  assert.equal(panelCalls.at(-1).pathname, '/api/protected_instance/open')
  assert.equal(panelCalls.at(-1).searchParams.get('uuid'), targetB.instanceUuid)
  await rejectsStatus(() => save({ instanceUuid: 'c'.repeat(32), daemonId: targetB.daemonId }), 404)
  same(db.getMcsmManagedInstance(), targetB)
  panelHook = () => db.setMcsmManagedInstance(targetA)
  await rejectsStatus(() => mcsm.assertManagedInstanceAllowed(targetB.instanceUuid, targetB.daemonId), 409)
  panelHook = undefined
  console.log('通过：旧目标拒绝、有效目标操作、面板归属校验和查询期间切换')

  db.setMcsmManagedInstance(targetB)
  const targetQuery = { uuid: targetB.instanceUuid, daemonId: targetB.daemonId }
  const viewer = { permissions: { 'server-manage': 'view' } }
  const commander = { permissions: { 'server-manage-command': 'edit' } }
  assert.equal((await log({ ...viewer, query: targetQuery })).text, '服务器日志\n')
  await rejectsStatus(() => log({ permissions: {}, query: targetQuery }), 403)
  const beforeRejected = panelCalls.length
  await rejectsStatus(() => power({ ...viewer, body: { ...targetQuery, action: 'restart' } }), 403)
  await rejectsStatus(() => command({ ...viewer, body: { ...targetQuery, command: 'list' } }), 403)
  await rejectsStatus(() => command({ ...commander, body: { ...targetQuery, command: 'list\nstop' } }), 400)
  await rejectsStatus(() => command({ ...commander, body: { ...targetQuery, command: 'x'.repeat(513) } }), 400)
  await rejectsStatus(() => power({ ...editor, body: { ...targetQuery, action: 'delete' } }), 400)
  assert.equal(panelCalls.length, beforeRejected, '权限和输入校验失败不能发起面板操作')
  await command({ ...commander, body: { ...targetQuery, command: 'say 测试 & 参数' } })
  assert.equal(panelCalls.at(-1).pathname, '/api/protected_instance/command')
  assert.equal(panelCalls.at(-1).searchParams.get('command'), 'say 测试 & 参数')
  assert.ok(audits.at(-1).includes('say 测试 & 参数'))
  for (const action of ['open', 'stop', 'restart', 'kill']) {
    await power({ ...editor, body: { ...targetQuery, action } })
    assert.equal(panelCalls.at(-1).pathname, '/api/protected_instance/' + action)
  }
  console.log('通过：日志只读权限、电源与指令独立权限、单条命令校验、操作接口与审计')

  db.setMcsmManagedInstance(targetB)
  panelHook = () => {
    db.setMcsmConfig({ baseUrl: 'https://replacement.example', apiKey: '' })
    db.setMcsmManagedInstance(targetB)
  }
  await rejectsStatus(() => mcsm.assertManagedInstanceAllowed(targetB.instanceUuid, targetB.daemonId), 409)
  panelHook = undefined
  db.setMcsmConfig({ baseUrl: 'https://panel.example', apiKey: '' })
  db.setMcsmManagedInstance(targetB)
  db.setMcsmConfig({ baseUrl: 'https://panel.example/', apiKey: '' })
  same(db.getMcsmManagedInstance(), targetB)
  assert.throws(() => db.setMcsmConfig({ baseUrl: 'invalid', apiKey: '' }), caught => caught.statusCode === 400)
  same(db.getMcsmManagedInstance(), targetB)
  db.setMcsmConfig({ baseUrl: 'https://other-panel.example', apiKey: '' })
  assert.equal(db.getMcsmManagedInstance(), null)
  db.setMcsmManagedInstance(targetB)
  db.setMcsmConfig({ baseUrl: 'https://other-panel.example', apiKey: 'new_test_key_1234567890' })
  assert.equal(db.getMcsmManagedInstance(), null)
  panelHook = () => db.setMcsmConfig({ baseUrl: 'https://changed.example', apiKey: '' })
  await rejectsStatus(() => save(targetB), 409)
  panelHook = undefined
  assert.equal(db.getMcsmManagedInstance(), null)
  await save(targetB)
  await save(null)
  assert.equal(db.getMcsmManagedInstance(), null)
  console.log('通过：连接不变保留绑定、更换连接清空绑定、并发连接变更拒绝、取消绑定')

  assert.equal(mapping.pageKeyForApi('/api/admin/mcsm-settings/instances'), 'settings')
  assert.equal(mapping.pageKeyForApi('/api/admin/mcsm-settings/instance'), 'settings')
  assert.equal(mapping.pageKeyForApi('/api/admin/mcsm/instance'), 'server-manage')
  assert.equal(mapping.isReadOperation('/api/admin/mcsm-settings/instance', 'PATCH'), false)

  // 实际设置页脚本与本地接口联动，确认有多个实例时也不会自动选择。
  browserFetch = async (url, request) => {
    if (url === '/api/admin/mcsm-settings') return JSON.parse(JSON.stringify(db.getAdminMcsmConfig()))
    if (url === '/api/admin/mcsm-settings/instances') return options(editor)
    if (url === '/api/admin/mcsm-settings/instance') return select({ ...editor, body: request.body })
    throw new Error('未模拟的页面接口：' + url)
  }
  const settings = compilePage('app/pages/settings.vue')
  await settings.loadMcsm()
  assert.equal(settings.mcsmSelectedKey.value, '')
  settings.mcsmSelectedKey.value = shared.mcsmInstanceKey(targetB)
  await settings.saveMcsmInstance()
  same(db.getMcsmManagedInstance(), targetB)
  await settings.loadMcsm()
  assert.equal(settings.mcsmSelectedKey.value, shared.mcsmInstanceKey(targetB))
  await save(targetA)
  await settings.loadMcsmInstances()
  assert.equal(settings.mcsmSelectedKey.value, shared.mcsmInstanceKey(targetA))
  await save(targetB)
  await settings.loadMcsmInstances()
  assert.equal(settings.mcsmSelectedKey.value, shared.mcsmInstanceKey(targetB))
  settings.mcsmForm.baseUrl = 'https://unsaved.example'
  settings.mcsmSelectedKey.value = shared.mcsmInstanceKey(targetA)
  await settings.saveMcsmInstance()
  same(db.getMcsmManagedInstance(), targetB)
  console.log('通过：设置页保存与回显、无默认实例、未保存连接时禁止绑定')

  let logResolve
  browserFetch = async (url) => {
    if (url === '/api/admin/mcsm/instance') return instance(editor)
    if (url === '/api/admin/mcsm/log') return new Promise(resolve => { logResolve = resolve })
    throw new Error('未模拟的管理页接口：' + url)
  }
  const manage = compilePage('app/pages/server-manage.vue')
  await manage.refreshAll()
  await vue.nextTick()
  const previousSource = sources.at(-1)
  assert.equal(manage.current.value.instanceUuid, targetB.instanceUuid)
  manage.command.value = 'stop'
  manage.powerConfirm.value = 'kill'
  const pendingLog = manage.loadLog()
  await save(targetA)
  await manage.refreshAll(true)
  await vue.nextTick()
  assert.equal(manage.current.value.instanceUuid, targetA.instanceUuid)
  assert.equal(manage.command.value, '')
  assert.equal(manage.powerConfirm.value, null)
  assert.equal(previousSource.closed, true)
  assert.ok(sources.at(-1).url.includes(targetA.instanceUuid))
  previousSource.emit('history', { text: '旧实例输出' })
  logResolve({ text: '延迟返回的旧实例日志' })
  await pendingLog
  assert.equal(manage.logText.value, '')
  await save(null)
  await manage.refreshAll(true)
  await vue.nextTick()
  assert.equal(manage.current.value, null)
  assert.equal(manage.instanceConfigured.value, false)
  assert.equal(sources.at(-1).closed, true)
  console.log('通过：管理页切换、关闭旧控制台、清空待确认操作、丢弃迟到日志与取消绑定')

  const sockets = []
  context.WebSocket = class {
    OPEN = 1
    readyState = 1
    sent = []
    listeners = new Map()
    constructor(url) { this.url = url; sockets.push(this) }
    addEventListener(name, callback) { this.listeners.set(name, callback) }
    send(frame) { this.sent.push(frame) }
    emit(frame) { this.listeners.get('message')?.({ data: frame }) }
    close() { this.readyState = 3; this.listeners.get('close')?.() }
  }
  panelHook = url => url.pathname === '/api/protected_instance/stream_channel'
    ? new Response(JSON.stringify({ status: 200, data: { addr: 'node.example:24444', password: 'test-stream-ticket' } }))
    : undefined
  const streaming = load('server/utils/mcsm-console-stream.ts')
  const output = []
  const closes = []
  let ready = false
  const pendingStream = streaming.openConsoleStream(targetB.instanceUuid, targetB.daemonId, {
    onText: text => output.push(text), onClose: reason => closes.push(reason),
  }).then(stream => { ready = true; return stream })
  while (!sockets.length) await Promise.resolve()
  const socket = sockets.at(-1)
  socket.emit('0{"pingInterval":20000}')
  assert.deepEqual(socket.sent, ['40'])
  socket.emit('40{"sid":"test"}')
  assert.equal(JSON.parse(socket.sent.at(-1).slice(2))[0], 'stream/auth')
  assert.equal(ready, false, '鉴权完成前不能向页面报告连接成功')
  socket.emit('42' + JSON.stringify(['stream/auth', { status: 200, data: true }]))
  const liveStream = await pendingStream
  socket.emit('2')
  assert.equal(socket.sent.at(-1), '3', '节点发 PING 后客户端只回复 PONG')
  assert.ok(!socket.sent.includes('2'), 'engine.io v4 客户端不能主动发送 PING')
  socket.emit('42' + JSON.stringify(['instance/stdout', { data: { instanceUuid: targetA.instanceUuid, text: '其他实例输出' } }]))
  socket.emit('42' + JSON.stringify(['instance/stdout', { data: { instanceUuid: targetB.instanceUuid, text: '\u001b[32m实时日志\u001b[0m\r\n' } }]))
  assert.deepEqual(output, ['实时日志\n'])
  liveStream.close()
  assert.equal(socket.readyState, 3)
  assert.equal(closes.length, 1)
  const rejectedStream = streaming.openConsoleStream(targetB.instanceUuid, targetB.daemonId, { onText: () => {}, onClose: () => {} })
  while (sockets.length < 2) await Promise.resolve()
  sockets.at(-1).emit('42' + JSON.stringify(['stream/auth', { status: 500, data: false }]))
  await assert.rejects(rejectedStream, /拒绝了实时控制台鉴权/)
  assert.equal(sockets.at(-1).readyState, 3)
  panelHook = undefined
  console.log('通过：实时日志鉴权、engine.io v4 心跳、实例输出隔离和拒绝鉴权后的资源释放')

  const files = [
    'server/middleware/admin-page-permissions.ts',
    ...readdirSync(path.join(root, 'server/api/admin/mcsm'), { recursive: true })
      .filter(file => file.endsWith('.ts')).map(file => 'server/api/admin/mcsm/' + file),
  ]
  for (const file of files) transpile(source(file), file)
  console.log('通过：Vue 脚本、模板、样式以及相关 TypeScript 语法检查')
} finally {
  for (const close of cleanup.reverse()) close()
  for (const connection of databases) connection.close()
}
