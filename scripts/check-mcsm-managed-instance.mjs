// 离线验证：SQLite 仅使用内存数据库，所有面板请求均由本地模拟响应处理。
// 在项目根目录执行 node scripts/check-mcsm-managed-instance.mjs，不启动 Nuxt 或 Minecraft。
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { MenuItemController } from '@material/web/menu/internal/controllers/menuItemController.js'

const root = fileURLToPath(new URL('../', import.meta.url))
assert.equal(path.resolve(process.cwd()), path.resolve(root), '请在 YouzaiWorldApi 项目根目录执行')
const require = createRequire(import.meta.url)
const compiler = require('vue/compiler-sfc')
const vue = require('vue')
const { renderToString } = require('vue/server-renderer')
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
const stagedUploads = new Map()
const forwardedUploads = []
const daemonFiles = new Map()
const databases = []
const cleanup = []
let panelHook
let stageHook
let browserFetch = async () => { throw new Error('未设置页面请求模拟') }
const browserRoute = vue.reactive({ query: {} })
const browserPermissions = vue.ref(null)
const toasts = []
const xhrRequests = []
const windowListeners = new Map()
const browserDownloads = []
const pageTemplates = new Map()
let browserAppBarBottom = 64
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
  window: {
    innerWidth: 1024,
    innerHeight: 768,
    scrollX: 0,
    scrollY: 0,
    addEventListener: (name, handler) => {
      if (!windowListeners.has(name)) windowListeners.set(name, new Set())
      windowListeners.get(name).add(handler)
    },
    removeEventListener: (name, handler) => windowListeners.get(name)?.delete(handler),
  },
  document: {
    hidden: false,
    documentElement: { clientWidth: 1024, clientHeight: 768 },
    querySelector: selector => selector === '.app-bar' ? { getBoundingClientRect: () => ({ bottom: browserAppBarBottom }) } : null,
    body: { appendChild: () => {} },
    createElement: tag => {
      if (tag === 'div') return {
        style: {}, remove: () => {},
        getBoundingClientRect: () => ({ right: context.document.documentElement.clientWidth, bottom: context.document.documentElement.clientHeight }),
      }
      assert.equal(tag, 'a', '只模拟下载链接，不操作真实浏览器')
      return { href: '', download: '', click() { browserDownloads.push({ href: this.href, name: this.download }) } }
    },
  },
  getComputedStyle: () => ({ direction: 'ltr' }),
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
    if (request.hostname === 'daemon.example') return new Response('测试文件')
    let data = {}
    if (request.pathname === '/api/auth') {
      data = { userName: '测试面板用户', permission: 1, apiKey: '不应出现在实例列表中的密钥', instances: [summary(targetA), summary(targetB)] }
    } else if (request.pathname === '/api/instance') {
      data = summary({ instanceUuid: request.searchParams.get('uuid'), daemonId: request.searchParams.get('daemonId') })
    } else if (request.pathname === '/api/files/list') {
      const search = request.searchParams.get('file_name')
      const items = search ? [...daemonFiles.entries()].filter(([name]) => name.includes(search))
        .map(([name, bytes]) => ({ name, type: 1, size: bytes.length })) : [{ name: 'test.txt', type: 1, size: 4 }]
      data = { items, total: items.length, pageSize: 100 }
    } else if (request.pathname === '/api/files/') {
      if (options.method === 'DELETE') {
        for (const name of JSON.parse(options.body).targets) daemonFiles.delete(name.replace(/^\//, ''))
        data = true
      } else data = '测试文本'
    } else if (request.pathname === '/api/files/move') {
      for (const [from, to] of JSON.parse(options.body).targets) {
        const sourceName = from.replace(/^\//, '')
        if (daemonFiles.has(sourceName)) {
          daemonFiles.set(to.replace(/^\//, ''), daemonFiles.get(sourceName))
          daemonFiles.delete(sourceName)
        }
      }
      data = true
    } else if (request.pathname === '/api/files/touch') {
      daemonFiles.set(JSON.parse(options.body).target.replace(/^\//, ''), Buffer.alloc(0))
      data = true
    } else if (request.pathname === '/api/files/upload' || request.pathname === '/api/files/download') {
      data = { addr: 'daemon.example:24444', password: 'test-ticket' }
    }
    return new Response(JSON.stringify({ status: 200, data }))
  },
})
context.XMLHttpRequest = class {
  listeners = new Map()
  progressListeners = new Map()
  upload = { addEventListener: (name, callback) => this.progressListeners.set(name, callback) }
  status = 200
  responseText = ''
  aborted = false
  constructor() { xhrRequests.push(this) }
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader() {}
  addEventListener(name, callback) { this.listeners.set(name, callback) }
  send(chunk) { this.chunk = chunk }
  complete() {
    if (!this.responseText) {
      const query = new URL(this.url, 'https://api.example').searchParams
      this.responseText = JSON.stringify({ ok: true, complete: query.get('final') === '1',
        uploaded: Number(query.get('offset')) + this.chunk.size })
    }
    this.listeners.get('load')?.()
  }
  abort() { this.aborted = true; this.listeners.get('abort')?.() }
}
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
    if (spec === 'node:fs') return {
      promises: new Proxy({}, { get: () => () => { throw new Error('测试禁止文件写入') } }),
      createWriteStream: target => {
        if (!stagedUploads.has(target)) stagedUploads.set(target, Buffer.alloc(0))
        return new Writable({
          write(chunk, _encoding, callback) {
            stagedUploads.set(target, Buffer.concat([stagedUploads.get(target), chunk]))
            callback()
          },
          final(callback) { stageHook?.(); callback() },
        })
      },
    }
    if (spec === 'node:fs/promises') return {
      mkdir: async () => {},
      appendFile: async (file, bytes, options) => {
        if (options.flag === 'wx' && stagedUploads.has(file)) throw Object.assign(new Error('已存在'), { code: 'EEXIST' })
        stagedUploads.set(file, Buffer.concat([stagedUploads.get(file) || Buffer.alloc(0), bytes]))
        stageHook?.()
      },
      readdir: async directory => [...stagedUploads.keys()].filter(file => path.dirname(file) === directory).map(file => path.basename(file)),
      rm: async file => { stagedUploads.delete(file) },
      stat: async file => {
        if (!stagedUploads.has(file)) throw Object.assign(new Error('不存在'), { code: 'ENOENT' })
        return { size: stagedUploads.get(file).length, mtimeMs: Date.now() }
      },
    }
    if (spec === 'h3') return { createError: error, getCookie: () => undefined, getHeader: () => undefined }
    if (spec === 'vue') return {
      ...vue,
      onMounted: () => {},
      onBeforeUnmount: callback => cleanup.push(callback),
      watch: (...args) => { const stop = vue.watch(...args); cleanup.push(stop); return stop },
    }
    if (['marked', 'jszip', 'mammoth', 'xlsx'].includes(spec)) return require(spec)
    if (spec.startsWith('node:')) return require(spec)
    let dependency
    if (spec.startsWith('#shared/')) dependency = path.join(root, 'shared', spec.slice(8) + '.ts')
    else if (spec.startsWith('.')) dependency = path.resolve(path.dirname(absolute), spec) + '.ts'
    else throw new Error('未模拟的依赖：' + spec)
    if (dependency === path.join(root, 'server/utils/data-dir.ts')) {
      return { dataDir: '/unused-mcsm-check', ensureDataDirs: () => {} }
    }
    if (dependency === path.join(root, 'server/utils/mcsm-upload.ts')) return {
      ...load(path.relative(root, dependency)),
      openStagedUpload: target => stagedUploads.get(target),
      forwardFileUpload: async (url, content, size, name, control) => {
        control.assertCurrent()
        daemonFiles.set(name, content)
        control.onTaskCompleted?.()
        forwardedUploads.push({ url, content, size, name })
      },
    }
    if (dependency === path.join(root, 'server/utils/db.ts') && absolute.includes(path.join('server', 'api'))) {
      return { ...db, requireFeaturePermission: permission, requirePagePermission: permission, recordAudit: () => {} }
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
  pageTemplates.set(file, template.code)
  for (const style of parsed.descriptor.styles) {
    assert.deepEqual(compiler.compileStyle({ source: style.content, filename: file, id: 'data-v-check', scoped: style.scoped }).errors, [])
  }
  return load(file, script.content).default.setup(props, { expose: () => {}, emit: (...args) => emitted.push(args) })
}

// 使用实际模板生成内存 HTML，子组件仅占位；不启动服务器或浏览器。
async function renderPageState(file, state) {
  const module = { exports: {} }
  const wrapper = vm.runInContext('(function(require,module,exports){' + transpile(pageTemplates.get(file), file) + '\n})', context)
  wrapper(spec => { assert.equal(spec, 'vue'); return vue }, module, module.exports)
  let vnode
  const app = vue.createSSRApp({ setup: () => state, render(...args) {
    vnode = module.exports.render.apply(this, args)
    return vnode
  } })
  for (const name of ['EmptyState', 'AppScrollbar', 'FilePreview', 'ConfirmDialog']) {
    app.component(name, { render: () => null })
  }
  app.config.warnHandler = message => { throw new Error('模板渲染警告：' + message) }
  const rendering = {}
  const html = await renderToString(app, rendering)
  return { html, menu: rendering.teleports?.body || '', vnode }
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
  assert.equal(mapping.pageKeyForApi('/api/admin/mcsm/files/instance'), 'server-files')
  assert.equal(mapping.pageKeyForApi('/api/admin/mcsm/instance'), 'server-manage')
  assert.equal(mapping.isReadOperation('/api/admin/mcsm-settings/instance', 'PATCH'), false)
  assert.equal(mapping.isReadOperation('/api/admin/mcsm/instance-config/async-status', 'POST'), true)

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

  const fileViewer = { permissions: { 'server-files': 'view' } }
  const fileEditor = { permissions: {
    'server-files': 'edit', 'server-files-edit': 'edit', 'server-files-upload': 'edit', 'server-files-delete': 'edit',
  } }
  const fileInstance = load('server/api/admin/mcsm/files/instance.get.ts').default
  const callsBeforeUnboundFiles = panelCalls.length
  same(await fileInstance(fileViewer), { configured: true, instanceConfigured: false, instance: null })
  assert.equal(panelCalls.length, callsBeforeUnboundFiles)
  await save(targetA)
  const fileSummary = await fileInstance({ ...fileViewer, query: { uuid: targetB.instanceUuid, daemonId: targetB.daemonId } })
  assert.equal(fileSummary.instance.instanceUuid, (await instance(editor)).instance.instanceUuid)
  assert.ok(!('instances' in fileSummary) && !('user' in fileSummary) && !('baseUrl' in fileSummary))
  await rejectsStatus(() => instance(fileEditor), 403)
  await rejectsStatus(() => options(fileEditor), 403)
  await rejectsStatus(() => fileInstance(editor), 403)

  const routeCases = [
    ['file.get.ts', 'query', { path: '/test.txt' }, '/api/files/'],
    ['files.get.ts', 'query', { path: '/' }, '/api/files/list'],
    ['files/status.get.ts', 'query', {}, '/api/files/status'],
    ['files/archive-preview.get.ts', 'query', { path: '/archive.zip' }, '/api/files/preview'],
    ['file.put.ts', 'body', { path: '/test.txt', text: '离线测试' }, '/api/files/'],
    ['files/create.post.ts', 'body', { path: '/', name: 'new.txt', kind: 'file' }, '/api/files/touch'],
    ['files/rename.post.ts', 'body', { path: '/old.txt', name: 'new.txt' }, '/api/files/move'],
    ['files/delete.post.ts', 'body', { paths: ['/old.txt'] }, '/api/files'],
    ['files/transfer.post.ts', 'body', { paths: ['/old.txt'], toDir: '/new', mode: 'copy' }, '/api/files/copy'],
    ['files/archive.post.ts', 'body', { paths: ['/old.txt'], dir: '/', name: 'new.zip', mode: 'compress' }, '/api/files/compress'],
    ['files/chmod.post.ts', 'body', { paths: ['/test.txt'], mode: 420 }, '/api/files/chmod'],
    ['files/download-from-url.post.ts', 'body', { url: 'https://files.example/test.txt', fileName: '/test.txt' }, '/api/files/download_from_url'],
    ['files/stop-download.post.ts', 'body', { fileName: '/test.txt' }, '/api/mod/stop_transfer'],
  ]
  for (const [routeFile, input, payload, panelPath] of routeCases) {
    const handler = load('server/api/admin/mcsm/' + routeFile).default
    const eventFor = (target, permissions = fileEditor) => ({ ...permissions, [input]: { ...payload, uuid: target.instanceUuid, daemonId: target.daemonId } })
    const before = panelCalls.length
    await rejectsStatus(() => handler(eventFor(targetB)), 409)
    assert.equal(panelCalls.length, before, routeFile + ' 的旧目标必须在外呼前拒绝')
    await handler(eventFor(targetA))
    const last = panelRequests.at(-1)
    assert.equal(last.url.pathname, panelPath)
    assert.equal(last.url.searchParams.get('uuid') || JSON.parse(last.options.body).uuid, targetA.instanceUuid)
    if (input === 'body') await rejectsStatus(() => handler(eventFor(targetA, fileViewer)), 403)
    else await handler(eventFor(targetA, fileViewer))
  }

  const fileList = load('server/api/admin/mcsm/files.get.ts').default
  const fileListEvent = { ...fileViewer, query: { uuid: targetA.instanceUuid, daemonId: targetA.daemonId, path: '/mods' } }
  const modEntries = count => Array.from({ length: count }, (_, index) => ({
    name: `mod-${String(index).padStart(3, '0')}.jar`, type: 1, size: index + 1,
  }))
  const pagedModEntries = modEntries(146)
  const pagedDirectoryEntries = Array.from({ length: 146 }, (_, index) => ({
    name: `folder-${String(index).padStart(3, '0')}`, type: 0, size: 0,
  })).concat([{ name: 'config.json', type: 1, size: 10 }])
  const directoryResponse = (request, entries, overrides = {}) => {
    const page = Number(request.searchParams.get('page'))
    assert.equal(Number(request.searchParams.get('page_size')), 100, '遵守修改版面板每页最多 100 项的限制')
    return new Response(JSON.stringify({ status: 200, data: {
      page, pageSize: 100, total: entries.length, items: entries.slice(page * 100, (page + 1) * 100), ...overrides,
    } }))
  }
  const requestedFilePages = start => panelCalls.slice(start).filter(request => request.pathname === '/api/files/list')
    .map(request => Number(request.searchParams.get('page')))
  for (const count of [0, 1, 100, 146, 200, 301]) {
    panelHook = request => request.pathname === '/api/files/list' ? directoryResponse(request, modEntries(count)) : undefined
    const start = panelCalls.length
    const result = await fileList(fileListEvent)
    assert.equal(result.items.length, count)
    assert.equal(result.total, count)
    assert.equal(result.path, '/mods')
    assert.equal(new Set(result.items.map(item => item.name)).size, count)
    same(requestedFilePages(start), Array.from({ length: Math.max(1, Math.ceil(count / 100)) }, (_, page) => page))
  }
  panelHook = request => request.pathname === '/api/files/list' ? directoryResponse(request, pagedModEntries) : undefined
  const explicitPageStart = panelCalls.length
  const explicitPage = await fileList({ ...fileListEvent, query: { ...fileListEvent.query, page: '1' } })
  assert.equal(explicitPage.page, 1)
  assert.equal(explicitPage.pageSize, 100)
  assert.equal(explicitPage.items.length, 46)
  assert.equal(explicitPage.total, 146)
  same(requestedFilePages(explicitPageStart), [1], '显式页码继续支持单页读取')
  for (const [overrides, status] of [
    [{ items: [] }, 409], [{ total: 147 }, 409], [{ pageSize: 50 }, 409],
    [{ items: pagedModEntries.slice(0, 46) }, 409], [{ page: 0 }, 502], [{ pageSize: 0 }, 502],
  ]) {
    panelHook = request => request.pathname === '/api/files/list'
      ? directoryResponse(request, pagedModEntries, request.searchParams.get('page') === '1' ? overrides : {}) : undefined
    await rejectsStatus(() => fileList(fileListEvent), status)
  }
  panelHook = request => {
    if (request.pathname !== '/api/files/list') return
    if (request.searchParams.get('page') === '1') throw new Error('模拟后续分页网络失败')
    return directoryResponse(request, pagedModEntries)
  }
  await rejectsStatus(() => fileList(fileListEvent), 504)
  panelHook = request => request.pathname === '/api/files/list'
    ? directoryResponse(request, pagedModEntries, { total: 100_001 }) : undefined
  await rejectsStatus(() => fileList(fileListEvent), 413)
  panelHook = request => {
    if (request.pathname !== '/api/files/list') return
    if (request.searchParams.get('page') === '1') db.setMcsmManagedInstance(targetB)
    return directoryResponse(request, pagedModEntries)
  }
  await rejectsStatus(() => fileList(fileListEvent), 409)
  panelHook = undefined
  await save(targetA)
  console.log('通过：目录默认合并全部分页、146 项完整返回、整页边界及显式分页、异常或切换实例时不返回残缺列表')

  const raw = load('server/api/admin/mcsm/files/raw.get.ts').default
  const rawEvent = target => ({ ...fileViewer, query: { uuid: target.instanceUuid, daemonId: target.daemonId, path: '/test.txt' } })
  await rejectsStatus(() => raw(rawEvent(targetB)), 409)
  await (await raw(rawEvent(targetA))).cancel()
  panelHook = request => { if (request.pathname === '/api/files/download') db.setMcsmManagedInstance(targetB) }
  await rejectsStatus(() => raw(rawEvent(targetA)), 409)
  assert.equal(panelCalls.at(-1).pathname, '/api/files/download', '失效下载票据不能继续访问守护进程')
  panelHook = undefined
  await save(null)
  for (const [routeFile, input, payload] of routeCases) {
    const handler = load('server/api/admin/mcsm/' + routeFile).default
    await rejectsStatus(() => handler({ ...fileEditor, [input]: { ...payload, uuid: targetA.instanceUuid, daemonId: targetA.daemonId } }), 503)
  }
  console.log('通过：两页共用绑定、文件独立权限、所有文件操作拒绝旧实例、下载票据失效与取消绑定')

  const upload = load('server/api/admin/mcsm/files/upload-chunk.put.ts').default
  const uploadCheck = load('server/api/admin/mcsm/files/upload-check.get.ts').default
  const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const chunkEvent = (target, offset, content, extra = {}, userId = 1) => ({
    ...fileEditor, userId, headers: { 'content-length': String(Buffer.byteLength(content)) },
    query: { uuid: target.instanceUuid, daemonId: target.daemonId, path: '/', name: 'test.txt', uploadId,
      offset, total: 2, final: offset === 0 ? '0' : '1', ...extra },
    node: { req: Readable.from(content ? [Buffer.from(content)] : []),
      res: Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false }) },
  })
  await save(targetA)
  assert.equal(mapping.pageKeyForApi('/api/admin/mcsm/files/upload-check'), 'server-files')
  const checkEvent = { ...fileEditor, query: { uuid: targetA.instanceUuid, daemonId: targetA.daemonId, path: '/', name: 'test.txt' } }
  await rejectsStatus(() => uploadCheck({ ...checkEvent, ...fileViewer }), 403)
  await rejectsStatus(() => uploadCheck({ ...checkEvent, query: { ...checkEvent.query, uuid: targetB.instanceUuid } }), 409)
  assert.equal((await uploadCheck(checkEvent)).name, 'test.txt')
  same(await upload(chunkEvent(targetA, 0, 'a')), { ok: true, uploaded: 1, complete: false })
  assert.equal(stagedUploads.size, 1)
  await save(targetB)
  await rejectsStatus(() => upload(chunkEvent(targetA, 1, 'b')), 409)
  await rejectsStatus(() => upload(chunkEvent(targetB, 1, 'b')), 409)
  await save(targetA)
  await rejectsStatus(() => upload(chunkEvent(targetA, 1, 'b', { path: '/other' })), 409)
  await rejectsStatus(() => upload(chunkEvent(targetA, 1, 'b', { name: 'other.txt' })), 409)
  await rejectsStatus(() => upload(chunkEvent(targetA, 1, 'b', {}, 2)), 409)
  const completedUpload = await upload(chunkEvent(targetA, 1, 'b'))
  assert.equal(completedUpload.complete, true)
  assert.equal(forwardedUploads.at(-1).content.toString(), 'ab')
  assert.equal(stagedUploads.size, 0)
  const withoutLength = chunkEvent(targetA, 0, 'abc', { total: 3, final: '1', overwrite: '1' })
  withoutLength.headers = {}
  assert.equal((await upload(withoutLength)).uploaded, 3)
  assert.equal(daemonFiles.get('test.txt').toString(), 'abc')
  assert.equal((await upload(chunkEvent(targetA, 0, '', { total: 0, final: '1', name: 'empty.txt' }))).complete, true)
  assert.equal(daemonFiles.get('empty.txt').length, 0)
  await rejectsStatus(() => upload(chunkEvent(targetA, 0, '', { total: 2, final: '0' })), 400)
  const oversizedChunk = chunkEvent(targetA, 0, 'x'.repeat(128 * 1024 + 1), { total: 128 * 1024 + 2 })
  oversizedChunk.headers = {}
  await rejectsStatus(() => upload(oversizedChunk), 413)
  const wrongLength = chunkEvent(targetA, 0, 'abc', { total: 3, final: '1' })
  wrongLength.headers['content-length'] = '2'
  await rejectsStatus(() => upload(wrongLength), 400)
  assert.equal(stagedUploads.size, 0)
  const completedCount = forwardedUploads.length
  stageHook = () => db.setMcsmManagedInstance(targetB)
  await rejectsStatus(() => upload(chunkEvent(targetA, 0, 'x', { total: 1, final: '1' })), 409)
  stageHook = undefined
  await save(targetA)
  panelHook = request => { if (request.pathname === '/api/files/upload') db.setMcsmManagedInstance(targetB) }
  await rejectsStatus(() => upload(chunkEvent(targetA, 0, 'x', { total: 1, final: '1', name: 'ticket-change.txt' })), 409)
  panelHook = undefined
  assert.equal(forwardedUploads.length, completedCount, '绑定变化后的上传不能转发到守护进程')
  assert.equal(stagedUploads.size, 0)
  await save(null)
  await rejectsStatus(() => upload(chunkEvent(targetA, 0, 'x', { total: 1, final: '1' })), 503)
  console.log('通过：上传会话隔离、完整分块拼接、收块及取票据期间切换阻断；暂存仅在内存中模拟')

  const uploadDirectory = load('server/api/admin/mcsm/files/upload-directory.post.ts').default
  const uploadOnly = { permissions: { 'server-files': 'edit', 'server-files-upload': 'edit' } }
  const directoryEvent = (name, overrides = {}) => ({ ...uploadOnly, body: {
    uuid: targetA.instanceUuid, daemonId: targetA.daemonId, path: '/folder-tests', name, ...overrides,
  } })
  const remoteDirectories = new Map([['/folder-tests', 0], ['/folder-tests/Existing', 0], ['/folder-tests/occupied', 1]])
  const mkdirCalls = []
  let switchDuringDirectoryLookup = false
  await save(targetA)
  panelHook = (request, options) => {
    if (request.pathname === '/api/files/list') {
      const directory = request.searchParams.get('target')
      const items = [...remoteDirectories].filter(([target]) => path.posix.dirname(target) === directory)
        .map(([target, type]) => ({ name: path.posix.basename(target), type, size: 0 }))
      if (switchDuringDirectoryLookup) {
        switchDuringDirectoryLookup = false
        db.setMcsmManagedInstance(targetB)
      }
      return new Response(JSON.stringify({ status: 200, data: { items, total: items.length, pageSize: 100 } }))
    }
    if (request.pathname === '/api/files/mkdir') {
      const target = JSON.parse(options.body).target
      mkdirCalls.push(target)
      if (!target.endsWith('/unconfirmed')) remoteDirectories.set(target, 0)
      if (target.endsWith('/raced')) throw error({ statusCode: 409, statusMessage: '其他请求已创建此目录' })
      return new Response(JSON.stringify({ status: 200, data: true }))
    }
  }
  try {
    assert.equal(mapping.pageKeyForApi('/api/admin/mcsm/files/upload-directory'), 'server-files')
    await rejectsStatus(() => uploadDirectory({ ...directoryEvent('denied'), ...fileViewer }), 403)
    await rejectsStatus(() => uploadDirectory({ ...directoryEvent('denied'), permissions: { 'server-files-edit': 'edit' } }), 403)
    await rejectsStatus(() => uploadDirectory(directoryEvent('wrong-instance', { uuid: targetB.instanceUuid })), 409)
    for (const name of ['..', '../escape', 'a/b', 'a\\b', 'C:folder', 'a'.repeat(201)]) {
      await rejectsStatus(() => uploadDirectory(directoryEvent(name)), 400)
    }
    await rejectsStatus(() => uploadDirectory(directoryEvent('child', { path: '/../outside' })), 400)
    await rejectsStatus(() => uploadDirectory(directoryEvent('child', { path: '/' + 'a'.repeat(508) })), 400)
    assert.equal(mkdirCalls.length, 0, '无权限、旧实例与非法路径不得创建目录')
    same(await uploadDirectory(directoryEvent('new')), { ok: true, name: 'new', path: '/folder-tests/new', created: true })
    same(await uploadDirectory(directoryEvent('new')), { ok: true, name: 'new', path: '/folder-tests/new', created: false })
    same(await uploadDirectory(directoryEvent('existing')), { ok: true, name: 'Existing', path: '/folder-tests/Existing', created: false })
    same(await uploadDirectory(directoryEvent('child', { path: '/folder-tests/Existing' })), {
      ok: true, name: 'child', path: '/folder-tests/Existing/child', created: true,
    })
    const beforeOccupied = mkdirCalls.length
    await rejectsStatus(() => uploadDirectory(directoryEvent('occupied')), 409)
    assert.equal(mkdirCalls.length, beforeOccupied, '同名文件不得被覆盖或替换成目录')
    assert.equal(remoteDirectories.get('/folder-tests/occupied'), 1)
    assert.equal((await uploadDirectory(directoryEvent('raced'))).created, false, '创建竞态复核后复用已存在目录')
    await rejectsStatus(() => uploadDirectory(directoryEvent('unconfirmed')), 502)
    switchDuringDirectoryLookup = true
    const beforeSwitch = mkdirCalls.length
    await rejectsStatus(() => uploadDirectory(directoryEvent('stale')), 409)
    assert.equal(mkdirCalls.length, beforeSwitch, '目录检查期间切换实例后不能继续创建')
    await save(null)
    await rejectsStatus(() => uploadDirectory(directoryEvent('unbound')), 503)
  } finally {
    panelHook = undefined
    await save(null)
  }
  console.log('通过：上传专用目录接口、独立上传权限、逐级创建、同名目录合并、文件冲突、创建竞态和实例隔离')

  const bindingStates = []
  const createFileBinding = load('app/composables/useMcsmFileInstance.ts').useMcsmFileInstance
  context.useMcsmFileInstance = () => {
    const state = createFileBinding()
    bindingStates.push(state)
    return state
  }
  const fileEntry = target => ({ name: target.instanceUuid[0] + '.txt', kind: 'text', size: 4, time: '', editable: true, previewable: true, mode: 420 })
  const pageRequests = []
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
  const settle = async () => { for (let index = 0; index < 32; index++) await vue.nextTick() }
  const delayedList = deferred()
  const delayedBrowse = deferred()
  const delayedCreate = deferred()
  const delayedMenuList = deferred()
  let uploadCheckHook
  let uploadDirectoryHook
  browserFetch = async (url, request) => {
    pageRequests.push({ url, request })
    if (url === '/api/admin/mcsm/files/instance') return fileInstance(fileEditor)
    if (url === '/api/admin/mcsm/files') {
      if (request.query.path === '/late-list') return delayedList.promise
      if (request.query.path === '/late-browse') return delayedBrowse.promise
      if (request.query.path === '/loading-menu-list') return delayedMenuList.promise
      if (['/paged-files', '/paged-dirs'].includes(request.query.path)) return fileList({ ...fileViewer, query: request.query })
      const target = request.query.uuid === targetA.instanceUuid ? targetA : targetB
      return { path: request.query.path, items: [fileEntry(target)], total: 1 }
    }
    if (url === '/api/admin/mcsm/files/create') return delayedCreate.promise
    if (url === '/api/admin/mcsm/files/upload-directory') {
      if (uploadDirectoryHook) return uploadDirectoryHook(request)
      return { ok: true, name: request.body.name, path: (request.body.path === '/' ? '' : request.body.path) + '/' + request.body.name, created: true }
    }
    if (url === '/api/admin/mcsm/files/upload-check') {
      if (uploadCheckHook) return uploadCheckHook(request)
      return { name: request.query.name, path: request.query.path + '/' + request.query.name, existing: null }
    }
    throw new Error('未模拟的文件页接口：' + url)
  }
  browserPermissions.value = fileEditor.permissions
  browserRoute.query = { uuid: targetB.instanceUuid, daemonId: targetB.daemonId }
  const filePage = compilePage('app/pages/server-files/index.vue')
  const unmountFilePage = cleanup.at(-1)
  await filePage.refreshInstance()
  assert.equal(filePage.instance.value, null)
  assert.equal(filePage.instanceConfigured.value, false)
  assert.equal(filePage.canConfigureMcsm.value, false)
  assert.equal(filePage.uploadQueueOpen.value, false, '首次进入页面默认收起上传队列')
  assert.doesNotMatch(source('app/pages/server-files/index.vue'), /selectedKey|loadInstances|\/api\/admin\/mcsm\/instances/)
  const filePageSource = source('app/pages/server-files/index.vue')
  assert.doesNotMatch(filePageSource, /ServerFileAdvanced|file-instance-card|与「服务器管理」共用站点设置中的管理实例/)
  assert.match(filePageSource, /class="card upload-panel"/)
  assert.match(filePageSource, /v-for="task in orderedUploadTasks"/)
  assert.match(filePageSource, /role="progressbar"/)
  const queueToggleMarkup = filePageSource.match(/<md-icon-button\b[^>]*class="upload-queue-toggle"[^>]*>([\s\S]*?)<\/md-icon-button>/)
  assert.ok(queueToggleMarkup, '搜索框旁有上传队列开关')
  assert.equal(queueToggleMarkup[1].trim(), '<md-icon>cloud_upload</md-icon>', '上传队列按钮只显示图标')
  assert.match(queueToggleMarkup[0], /:aria-expanded="uploadQueueOpen"/)
  assert.match(queueToggleMarkup[0], /aria-controls="upload-queue"/)
  assert.match(filePageSource, /class="file-search-tools">\s*<md-outlined-text-field[\s\S]*?<\/md-outlined-text-field>\s*<md-icon-button\s+v-if="canUploadFiles \|\| uploadTasks.length"\s+class="upload-queue-toggle"/)
  assert.match(filePageSource, /'file-workspace--with-uploads': uploadQueueOpen &&/)
  assert.match(filePageSource, /v-if="uploadQueueOpen && \(canUploadFiles \|\| uploadTasks.length\)"/)
  for (const action of ['openPreview(entry)', 'savePreviewFile', 'downloadSelected', "openTransfer('copy')", "openTransfer('move')",
    'openCompress', 'openExtract(entry)', 'openRename(entry)', 'deleteSingle(entry)']) {
    assert.ok(filePageSource.includes(`@click="${action}"`), `保留现有文件操作：${action}`)
  }
  assert.match(filePageSource, /<FilePreview\b/)
  assert.equal(filePage.fileView.value, 'list', '默认保留列表视图')
  assert.equal((filePageSource.match(/@contextmenu\.prevent\.stop="openFileMenu\(\$event, entry\)"/g) || []).length, 2, '列表行和图标卡片都支持右键')
  assert.equal((filePageSource.match(/@keydown="onFileMenuKeydown\(\$event, entry\)"/g) || []).length, 2, '两种视图都支持键盘菜单')
  assert.match(filePageSource, /class="file-view-toggle"[\s\S]*?@click="toggleFileView"/)
  await save(targetA)
  await filePage.refreshInstance()
  await settle()
  assert.equal(filePage.instance.value.instanceUuid, targetA.instanceUuid, '地址栏参数不能覆盖站点绑定')
  assert.equal(filePage.items.value[0].name, 'a.txt')
  panelHook = request => request.pathname === '/api/files/list'
    ? directoryResponse(request, request.searchParams.get('target') === '/paged-dirs' ? pagedDirectoryEntries : pagedModEntries)
    : undefined
  await filePage.loadList('/paged-files')
  assert.equal(filePage.items.value.length, 146)
  assert.equal(filePage.total.value, 146)
  filePage.keyword.value = 'mod-145.jar'
  assert.equal(filePage.visibleItems.value.length, 1, '可搜索第一页之后的文件')
  assert.equal(filePage.visibleItems.value[0].name, 'mod-145.jar')
  filePage.keyword.value = ''
  filePage.setSort('size')
  filePage.setSort('size')
  assert.equal(filePage.visibleItems.value[0].name, 'mod-145.jar', '排序覆盖完整目录')
  filePage.setSort('name')
  filePage.toggleAll()
  assert.equal(filePage.selectedEntries.value.length, 146, '选择覆盖完整目录，未执行任何批量写操作')
  await filePage.loadTransferBrowseList('/paged-dirs')
  assert.equal(filePage.transferBrowseList.value.length, 146, '复制和移动的目录选择同样合并所有分页')
  assert.equal(filePage.transferBrowseList.value.at(-1).name, 'folder-145')
  const selectedBeforeViewChange = [...filePage.selectedNames.value]
  filePage.setSort('size')
  const sortedBeforeViewChange = filePage.visibleItems.value.map(item => item.name)
  filePage.toggleFileView()
  assert.equal(filePage.fileView.value, 'grid')
  same(filePage.selectedNames.value, selectedBeforeViewChange)
  same(filePage.visibleItems.value.map(item => item.name), sortedBeforeViewChange)
  const gridMarkup = await renderPageState('app/pages/server-files/index.vue', filePage)
  assert.equal((gridMarkup.html.match(/class="file-icon-item(?:\s[^"]*)?"/g) || []).length, 146, '大图标同样完整显示 146 个文件')
  assert.doesNotMatch(gridMarkup.html, /<table\b/)
  assert.match(gridMarkup.html, /class="icon-view-sorting"/)
  filePage.keyword.value = 'mod-145.jar'
  filePage.toggleFileView()
  assert.equal(filePage.fileView.value, 'list')
  assert.equal(filePage.keyword.value, 'mod-145.jar', '切换视图保留搜索条件')
  assert.equal(filePage.sortField.value, 'size', '切换视图保留排序')
  same(filePage.selectedNames.value, selectedBeforeViewChange)
  const listMarkup = await renderPageState('app/pages/server-files/index.vue', filePage)
  assert.match(listMarkup.html, /<table\b/)
  assert.doesNotMatch(listMarkup.html, /class="file-icon-grid"/)
  filePage.keyword.value = ''
  filePage.setSort('name')
  panelHook = undefined
  await filePage.loadList('/')
  console.log('通过：页面完整展示 146 个文件，跨页搜索、排序、选择及目标目录浏览')
  console.log('通过：列表与大图标切换保留筛选、排序和选择，实际模板完整渲染 146 个图标')

  const menuFixtures = [
    { ...fileEntry(targetA), name: 'mods', kind: 'directory', editable: false },
    { ...fileEntry(targetA), name: 'alpha.txt' },
    { ...fileEntry(targetA), name: 'beta.txt', size: 8 },
    { ...fileEntry(targetA), name: 'photo.png', kind: 'image', editable: false },
    { ...fileEntry(targetA), name: 'pack.zip', kind: 'archive', editable: false },
  ]
  const [menuFolder, menuAlpha, menuBeta, menuPhoto, menuArchive] = menuFixtures
  const resetMenuFixtures = () => {
    filePage.path.value = '/context-test'
    filePage.items.value = [...menuFixtures]
    filePage.total.value = menuFixtures.length
    filePage.keyword.value = ''
    filePage.selectedNames.value = []
    filePage.closePreview()
    filePage.previewTarget.value = null
    filePage.renameTarget.value = null
    filePage.extractTarget.value = null
    filePage.transferMode.value = null
    filePage.compressOpen.value = false
    filePage.deleteOpen.value = false
  }
  const menuTrigger = { matches: () => true, getBoundingClientRect: () => ({ left: 36, bottom: 84 }), focus: () => {} }
  const menuRow = { matches: () => false, querySelector: () => menuTrigger }
  const menuEvent = (overrides = {}) => ({
    type: 'contextmenu', clientX: 120, clientY: 160, currentTarget: menuRow,
    defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.stopped = true }, ...overrides,
  })
  const openMenu = entry => filePage.openFileMenu(menuEvent(), entry)
  const renderFilePage = () => renderPageState('app/pages/server-files/index.vue', filePage)
  const menuNodes = node => !node || typeof node !== 'object' ? []
    : [node, ...(Array.isArray(node.children) ? node.children.flatMap(menuNodes) : [])]
  const openRenderedMenu = async (entry, view, trigger = 'contextmenu') => {
    filePage.fileView.value = view
    const fileNode = menuNodes((await renderFilePage()).vnode).find(node =>
      node.type === (view === 'grid' ? 'li' : 'tr') && node.key === entry.name)
    assert.ok(fileNode, '实际模板中存在目标文件')
    if (trigger === 'more') {
      const more = menuNodes(fileNode).find(node => node.type === 'md-icon-button' && node.props?.title === '更多操作')
      more.props.onClick(menuEvent({ type: 'click', currentTarget: menuTrigger }))
    } else fileNode.props.onContextmenu(menuEvent())
    return menuNodes((await renderFilePage()).vnode).find(node =>
      node.type === 'md-menu' && node.props?.anchor === 'file-context-anchor')
  }
  const activateRenderedMenu = async (menu, label, key) => {
    const item = menuNodes(menu).find(node => node.type === 'md-menu-item'
      && node.children?.some(child => child.props?.slot === 'headline' && child.children === label))
    assert.ok(item, '实际菜单中存在操作：' + label)
    const controller = new MenuItemController({
      type: item.props.type || 'menuitem', keepOpen: item.props['keep-open'] !== undefined, href: '', addController() {},
      dispatchEvent(event) {
        if (event.type === 'close-menu') queueMicrotask(() => menu.props.onClosed({ target: {
          dataset: { menuId: String(menu.props['data-menu-id']) },
        } }))
        return true
      },
    }, {})
    if (key) {
      const event = { code: key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
      controller.onKeydown(event)
      await settle()
      if (key === 'Escape') return
      assert.equal(controller.tagName, 'button', '键盘选择由原生按钮产生点击')
      assert.equal(event.defaultPrevented, false, '回车和空格不能提前关闭菜单')
    }
    // 复现浏览器在组件内部监听器与外层 Vue 点击监听器之间执行关闭微任务的顺序。
    controller.onClick()
    await settle()
    item.props.onClick(new Event('click'))
    await settle()
  }
  const clickCases = [
    { label: '编辑', entry: menuAlpha, check: () => assert.equal(filePage.previewTarget.value?.name, 'alpha.txt') },
    { label: '预览', entry: menuPhoto, check: () => assert.equal(filePage.previewTarget.value?.name, 'photo.png') },
    { label: '打开文件夹', entry: menuFolder, check: () => assert.equal(filePage.path.value, '/context-test/mods') },
    { label: '下载', entry: menuAlpha, check: count => assert.equal(browserDownloads.length, count + 1) },
    { label: '复制到…', entry: menuAlpha, check: () => assert.equal(filePage.transferMode.value, 'copy') },
    { label: '移动到…', entry: menuAlpha, check: () => assert.equal(filePage.transferMode.value, 'move') },
    { label: '重命名', entry: menuAlpha, check: () => assert.equal(filePage.renameTarget.value?.name, 'alpha.txt') },
    { label: '压缩为 ZIP', entry: menuAlpha, check: () => assert.equal(filePage.compressOpen.value, true) },
    { label: '解压', entry: menuArchive, check: () => assert.equal(filePage.extractTarget.value?.name, 'pack.zip') },
    { label: '删除', entry: menuAlpha, check: () => assert.equal(filePage.deleteOpen.value, true) },
    { label: '选择此项', entry: menuAlpha, check: () => same(filePage.selectedNames.value, ['alpha.txt']) },
    { label: '全选', entry: menuAlpha, selection: ['alpha.txt'], check: () => assert.equal(filePage.selectedNames.value.length, 5) },
    { label: '反选', entry: menuAlpha, selection: ['alpha.txt'], check: () => {
      assert.equal(filePage.selectedNames.value.length, 4)
      assert.equal(filePage.selectedNames.value.includes('alpha.txt'), false)
    } },
    { label: '取消选择', entry: menuAlpha, selection: ['alpha.txt'], check: () => same(filePage.selectedNames.value, []) },
  ]
  for (const view of ['grid', 'list']) {
    for (const sample of clickCases) {
      resetMenuFixtures()
      filePage.selectedNames.value = sample.selection || []
      const downloadsBeforeClick = browserDownloads.length
      await activateRenderedMenu(await openRenderedMenu(sample.entry, view), sample.label)
      sample.check(downloadsBeforeClick)
      assert.equal(filePage.fileMenu.value, null, '执行操作后菜单关闭')
    }
    for (const key of ['Enter', 'Space', 'Escape']) {
      resetMenuFixtures()
      await activateRenderedMenu(await openRenderedMenu(menuAlpha, view, 'more'), '重命名', key)
      assert.equal(filePage.renameTarget.value?.name ?? null, key === 'Escape' ? null : 'alpha.txt')
      assert.equal(filePage.fileMenu.value, null)
    }
  }
  console.log('通过：大图标与列表的实际模板点击、Material 提前关闭竞态、全部菜单操作、更多按钮与回车/空格/Esc')
  resetMenuFixtures()
  const pointerMenuEvent = menuEvent()
  filePage.openFileMenu(pointerMenuEvent, menuAlpha)
  assert.equal(pointerMenuEvent.defaultPrevented, true)
  same(filePage.selectedNames.value, [], '普通右键不强制进入多选')
  same(filePage.fileMenu.value.names, ['alpha.txt'])
  assert.equal(filePage.fileMenu.value.selectionMode, false)
  assert.equal(filePage.fileMenu.value.x, 120)
  assert.equal(filePage.fileMenu.value.y, 160)
  const singleMenuMarkup = (await renderFilePage()).menu
  for (const label of ['编辑', '下载', '复制到…', '移动到…', '重命名', '压缩为 ZIP', '删除', '选择此项']) {
    assert.ok(singleMenuMarkup.includes(`<span slot="headline">${label}</span>`), `单文件保留菜单操作：${label}`)
  }
  assert.doesNotMatch(singleMenuMarkup, />全选<|>反选<|>取消选择</)
  filePage.runFileMenuAction('open')
  assert.equal(filePage.previewOpen.value, true)
  assert.equal(filePage.previewTarget.value.name, 'alpha.txt')
  assert.equal(filePage.fileMenu.value, null)
  filePage.closePreview()
  openMenu(menuAlpha)
  filePage.runFileMenuAction('rename')
  assert.equal(filePage.renameTarget.value.name, 'alpha.txt')
  filePage.renameTarget.value = null
  openMenu(menuAlpha)
  filePage.runFileMenuAction('download')
  assert.equal(browserDownloads.at(-1).name, 'alpha.txt')
  const menuDownload = new URL(browserDownloads.at(-1).href, 'https://api.example')
  assert.equal(menuDownload.searchParams.get('path'), '/context-test/alpha.txt')
  assert.equal(menuDownload.searchParams.get('uuid'), targetA.instanceUuid)
  assert.equal(menuDownload.searchParams.get('download'), '1')
  same(filePage.selectedNames.value, [], '下载单个文件不更改选中状态')
  openMenu(menuArchive)
  filePage.runFileMenuAction('extract')
  assert.equal(filePage.extractTarget.value.name, 'pack.zip')
  filePage.extractTarget.value = null
  openMenu(menuAlpha)
  filePage.runFileMenuAction('extract')
  assert.equal(filePage.extractTarget.value, null, '普通文本不能调用解压')
  openMenu(menuFolder)
  const folderMenuMarkup = (await renderFilePage()).menu
  assert.match(folderMenuMarkup, />打开文件夹</)
  assert.doesNotMatch(folderMenuMarkup, />下载<|>编辑</)
  filePage.runFileMenuAction('open')
  await settle()
  assert.equal(filePage.path.value, '/context-test/mods')

  resetMenuFixtures()
  openMenu(menuAlpha)
  filePage.runFileMenuAction('select')
  same(filePage.selectedNames.value, ['alpha.txt'])
  filePage.toggleSelect('beta.txt')
  openMenu(menuAlpha)
  same(filePage.fileMenu.value.names, ['alpha.txt', 'beta.txt'], '右键已选项必须保留整组')
  assert.equal(filePage.fileMenuSingle.value, null)
  const multiMenuMarkup = (await renderFilePage()).menu
  for (const label of ['下载', '复制到…', '移动到…', '压缩为 ZIP', '删除', '全选', '反选', '取消选择']) {
    assert.ok(multiMenuMarkup.includes(`<span slot="headline">${label}</span>`), `多选菜单操作：${label}`)
  }
  assert.doesNotMatch(multiMenuMarkup, />编辑<|>重命名<|>解压</)
  const writesBeforeMenus = pageRequests.filter(({ request }) => request?.method && request.method !== 'GET').length
  for (const action of ['copy', 'move', 'compress', 'delete']) {
    openMenu(menuAlpha)
    filePage.runFileMenuAction(action)
    same(filePage.selectedNames.value, ['alpha.txt', 'beta.txt'], `${action} 使用整组选择`)
    if (action === 'copy' || action === 'move') assert.equal(filePage.transferMode.value, action)
    if (action === 'compress') assert.equal(filePage.compressOpen.value, true)
    if (action === 'delete') assert.equal(filePage.deleteOpen.value, true)
    filePage.transferMode.value = null
    filePage.compressOpen.value = false
    filePage.deleteOpen.value = false
    await settle()
  }
  assert.equal(pageRequests.filter(({ request }) => request?.method && request.method !== 'GET').length, writesBeforeMenus,
    '菜单只打开原有确认流程，不立即修改或删除文件')
  const downloadsBeforeMulti = browserDownloads.length
  openMenu(menuAlpha)
  filePage.runFileMenuAction('download')
  assert.equal(browserDownloads.length, downloadsBeforeMulti)
  assert.match(toasts.at(-1)[0], /先使用.*压缩/, '保留多文件先打包再下载的提示')
  openMenu(menuPhoto)
  same(filePage.selectedNames.value, ['photo.png'], '右键未选项不能误操作原来的整组')
  assert.equal(filePage.fileMenu.value.selectionMode, true, '只选一项时仍保留多选管理选项')
  assert.equal(filePage.fileMenuSingle.value.name, 'photo.png')
  assert.match((await renderFilePage()).menu, />预览</)

  filePage.keyword.value = '.txt'
  filePage.selectedNames.value = ['alpha.txt', 'photo.png']
  openMenu(menuAlpha)
  filePage.runFileMenuAction('invert')
  same(filePage.selectedNames.value, ['beta.txt'], '反选只针对当前筛选结果，不保留隐藏条目')
  for (let repeat = 0; repeat < 2; repeat++) {
    openMenu(menuBeta)
    filePage.runFileMenuAction('select-all')
    same(filePage.selectedNames.value, ['alpha.txt', 'beta.txt'], '全选是明确选择，不是重复点击后取消')
  }
  openMenu(menuAlpha)
  filePage.runFileMenuAction('invert')
  same(filePage.selectedNames.value, [])
  filePage.selectedNames.value = ['alpha.txt', 'beta.txt']
  openMenu(menuAlpha)
  filePage.runFileMenuAction('clear')
  same(filePage.selectedNames.value, [])
  assert.equal(filePage.fileMenu.value, null)

  resetMenuFixtures()
  browserPermissions.value = fileViewer.permissions
  openMenu(menuAlpha)
  const readonlyMenuMarkup = (await renderFilePage()).menu
  assert.match(readonlyMenuMarkup, />预览</)
  assert.match(readonlyMenuMarkup, />下载</)
  assert.doesNotMatch(readonlyMenuMarkup, />编辑<|>复制到…<|>移动到…<|>重命名<|>删除<|>压缩为 ZIP</)
  filePage.runFileMenuAction('open')
  assert.equal(filePage.previewOpen.value, true, '只读用户仍可预览')
  filePage.closePreview()
  for (const action of ['copy', 'move', 'rename', 'compress', 'extract', 'delete']) {
    browserPermissions.value = fileEditor.permissions
    openMenu(menuArchive)
    browserPermissions.value = fileViewer.permissions
    filePage.runFileMenuAction(action)
    assert.equal(filePage.transferMode.value, null)
    assert.equal(filePage.renameTarget.value, null)
    assert.equal(filePage.compressOpen.value, false)
    assert.equal(filePage.extractTarget.value, null)
    assert.equal(filePage.deleteOpen.value, false)
    same(filePage.selectedNames.value, [], '权限收回后不能借旧菜单操作')
  }
  browserPermissions.value = { 'server-files': 'edit', 'server-files-delete': 'edit' }
  openMenu(menuAlpha)
  const deleteOnlyMenuMarkup = (await renderFilePage()).menu
  assert.match(deleteOnlyMenuMarkup, />删除</)
  assert.doesNotMatch(deleteOnlyMenuMarkup, />复制到…</)
  filePage.runFileMenuAction('delete')
  assert.equal(filePage.deleteOpen.value, true, '删除与编辑权限仍然独立')
  browserPermissions.value = fileEditor.permissions
  resetMenuFixtures()
  console.log('通过：单文件菜单、多选整组操作、筛选后的全选/反选/取消、既有确认流程与独立权限')

  const { SurfacePositionController } = load('node_modules/@material/web/menu/internal/controllers/surfacePositionController.js')
  const menuLayouts = [
    { name: '中央点击仍完整显示长菜单', viewport: [1024, 768], bar: 64, click: [500, 400], size: [320, 600], position: [500, 160] },
    { name: '右下角整体向内移动', viewport: [1024, 768], bar: 64, click: [2000, 2000], size: [320, 600], position: [696, 160] },
    { name: '左上角避让实际顶栏', viewport: [1024, 768], bar: 96, click: [-10, -10], size: [320, 600], position: [8, 104] },
    { name: '较矮桌面完整显示紧凑菜单', viewport: [1366, 600], bar: 64, click: [700, 320], size: [320, 443], position: [700, 149] },
    { name: '手机右下角避让较矮顶栏', viewport: [390, 844], bar: 56, click: [380, 820], size: [320, 487], position: [62, 349] },
    { name: '小窗口仅受可用高度限制', viewport: [360, 320], bar: 56, click: [180, 200], size: [216, 248], position: [136, 64] },
    { name: '极窄窗口宽度不越界', viewport: [200, 640], bar: 56, click: [200, 600], size: [184, 443], position: [8, 189] },
    { name: '排除浏览器滚动条宽度', viewport: [1024, 768], clientWidth: 1009, bar: 64, click: [1024, 700], size: [320, 443], position: [681, 317] },
    { name: '缩放后的可视区域', viewport: [1024, 768], bar: 64, click: [700, 650], size: [216, 300], position: [296, 292],
      visualViewport: { offsetLeft: 120, offsetTop: 200, width: 400, height: 400 } },
  ]
  try {
    for (const sample of menuLayouts) {
      const [viewportWidth, viewportHeight] = sample.viewport
      context.window.innerWidth = viewportWidth
      context.window.innerHeight = viewportHeight
      context.window.visualViewport = sample.visualViewport
      context.document.documentElement.clientWidth = sample.clientWidth ?? viewportWidth
      context.document.documentElement.clientHeight = viewportHeight
      browserAppBarBottom = sample.bar
      filePage.openFileMenu(menuEvent({ clientX: sample.click[0], clientY: sample.click[1] }), menuArchive)
      const menu = filePage.fileMenu.value
      const [width, height] = sample.size
      await filePage.positionFileMenu({ target: {
        dataset: { menuId: String(menu.id) }, getBoundingClientRect: () => ({ width, height }), reposition: () => {},
      } })
      same([menu.left, menu.top], sample.position, sample.name)
      assert.ok(menu.left >= menu.bounds.left && menu.top >= menu.bounds.top, sample.name)
      assert.ok(menu.left + width <= menu.bounds.left + menu.bounds.width, sample.name)
      assert.ok(menu.top + height <= menu.bounds.top + menu.bounds.height, sample.name)
      const markup = (await renderFilePage()).menu
      assert.ok(markup.includes(`--file-menu-available-height:${menu.bounds.height}px`), '实际模板传入可用高度')
      assert.ok(markup.includes(`--file-menu-available-width:${menu.bounds.width}px`), '实际模板传入可用宽度')
      assert.match(markup, /no-horizontal-flip/)
      assert.match(markup, /no-vertical-flip/)
      // 使用依赖的真实定位器复核，确认 Material 不会再次按点击点截短菜单。
      const controller = new SurfacePositionController({ addController() {}, requestUpdate() {}, updateComplete: Promise.resolve() }, () => ({
        anchorEl: { getBoundingClientRect: () => ({ left: menu.left, top: menu.top, right: menu.left + 1, bottom: menu.top + 1, width: 1, height: 1 }) },
        surfaceEl: { getBoundingClientRect: () => ({ width, height }) },
        anchorCorner: 'start-start', surfaceCorner: 'start-start', positioning: 'fixed',
        xOffset: 0, yOffset: 0, disableBlockFlip: true, disableInlineFlip: true, repositionStrategy: 'resize',
      }))
      await controller.position()
      assert.equal(controller.surfaceStyles.height, undefined, sample.name + '：组件不再额外截短高度')
      assert.equal(controller.surfaceStyles.width, undefined, sample.name + '：组件不再额外截短宽度')
      assert.equal(controller.surfaceStyles['inset-block-start'], `${menu.top}px`, sample.name)
      assert.equal(controller.surfaceStyles.left, `${menu.left}px`, sample.name)
    }
    browserAppBarBottom = context.document.documentElement.clientHeight
    openMenu(menuAlpha)
    assert.equal(filePage.fileMenu.value, null, '顶栏外没有可用空间时不在屏幕外显示菜单')
  } finally {
    context.window.innerWidth = context.document.documentElement.clientWidth = 1024
    context.window.innerHeight = context.document.documentElement.clientHeight = 768
    context.window.visualViewport = undefined
    browserAppBarBottom = 64
  }
  openMenu(menuAlpha)
  let staleRepositions = 0
  const staleOpening = { target: {
    dataset: { menuId: String(filePage.fileMenu.value.id) },
    getBoundingClientRect: () => ({ width: 320, height: 443 }), reposition: () => { staleRepositions++ },
  } }
  const pendingPosition = filePage.positionFileMenu(staleOpening)
  openMenu(menuBeta)
  await pendingPosition
  await filePage.positionFileMenu(staleOpening)
  assert.equal(staleRepositions, 0, '快速连续右键时，迟到的定位不能影响新菜单')
  assert.equal(filePage.fileMenu.value.entryName, 'beta.txt')
  console.log('通过：九组菜单边界、顶栏避让、小窗口限制、真实 Material 定位器及连续右键竞态')

  openMenu(menuAlpha)
  const previousMenuId = filePage.fileMenu.value.id
  openMenu(menuBeta)
  filePage.onFileMenuClosed({ target: { dataset: { menuId: String(previousMenuId) } } })
  assert.equal(filePage.fileMenu.value.entryName, 'beta.txt', '迟到的旧关闭事件不能关闭新菜单')
  filePage.onFileMenuClosed({ target: { dataset: { menuId: String(filePage.fileMenu.value.id) } } })
  assert.equal(filePage.fileMenu.value, null)
  filePage.openFileMenu(menuEvent({ clientX: -10, clientY: 2000 }), menuAlpha)
  assert.equal(filePage.fileMenu.value.x, 8)
  assert.equal(filePage.fileMenu.value.y, 760)
  filePage.closeFileMenu()
  const plainF10 = menuEvent({ type: 'keydown', key: 'F10', shiftKey: false })
  filePage.onFileMenuKeydown(plainF10, menuAlpha)
  assert.equal(filePage.fileMenu.value, null)
  for (const keys of [{ key: 'F10', shiftKey: true }, { key: 'ContextMenu' }]) {
    const keyboardMenuEvent = menuEvent({ type: 'keydown', ...keys })
    filePage.onFileMenuKeydown(keyboardMenuEvent, menuAlpha)
    assert.equal(keyboardMenuEvent.defaultPrevented, true)
    assert.equal(keyboardMenuEvent.stopped, true)
    assert.equal(filePage.fileMenu.value.x, 36)
    assert.equal(filePage.fileMenu.value.y, 84, '键盘菜单定位到文件按钮下方')
    filePage.closeFileMenu()
  }
  filePage.openFileMenu(menuEvent({ type: 'click', currentTarget: menuTrigger }), menuAlpha)
  assert.equal(filePage.fileMenu.value.y, 84, '触屏更多按钮使用按钮边界定位')
  const mockMenuElement = {}
  filePage.fileMenuElement.value = mockMenuElement
  filePage.onFileMenuScroll({ composedPath: () => [filePage.fileMenuElement.value] })
  assert.ok(filePage.fileMenu.value, '菜单内部滚动保持打开')
  filePage.onFileMenuScroll({ composedPath: () => [] })
  assert.equal(filePage.fileMenu.value, null)
  filePage.fileMenuElement.value = null
  openMenu(menuAlpha)
  filePage.closeFileMenuOnResize()
  assert.equal(filePage.fileMenu.value, null)
  for (const changeView of [
    () => { filePage.keyword.value = '.txt' },
    () => filePage.toggleFileView(),
    () => filePage.setSort('size'),
    () => filePage.toggleSelect('beta.txt'),
    () => { filePage.items.value = [...menuFixtures] },
  ]) {
    resetMenuFixtures()
    openMenu(menuAlpha)
    changeView()
    assert.equal(filePage.fileMenu.value, null, '筛选、视图、排序、选择或内容变化立即关闭旧菜单')
  }
  resetMenuFixtures()
  openMenu(menuAlpha)
  const refreshedListing = filePage.loadList('/loading-menu-list')
  assert.equal(filePage.fileMenu.value, null, '刷新开始时关闭旧菜单')
  openMenu(menuAlpha)
  assert.equal(filePage.fileMenu.value, null, '加载过程中不能对旧条目打开菜单')
  for (const view of ['list', 'grid']) {
    filePage.fileView.value = view
    const loadingMarkup = await renderFilePage()
    assert.match(loadingMarkup.html, /class="file-list-loading" role="status"/)
    assert.match(loadingMarkup.html, /md-circular-progress/)
    assert.match(loadingMarkup.html, /正在加载文件列表/)
    assert.doesNotMatch(loadingMarkup.html, /<table\b|class="file-icon-grid"/, '两种视图的加载提示均替代旧文件列表')
  }
  delayedMenuList.resolve({ path: '/loading-menu-list', items: menuFixtures, total: menuFixtures.length })
  await refreshedListing
  resetMenuFixtures()
  openMenu(menuAlpha)
  const oldPathMenu = filePage.fileMenu.value
  filePage.path.value = '/another-directory'
  filePage.fileMenu.value = oldPathMenu
  filePage.runFileMenuAction('delete')
  assert.equal(filePage.deleteOpen.value, false, '迟到操作不能跨目录执行')
  resetMenuFixtures()
  openMenu(menuAlpha)
  const oldGenerationMenu = filePage.fileMenu.value
  filePage.resetFileState()
  resetMenuFixtures()
  filePage.fileMenu.value = oldGenerationMenu
  filePage.runFileMenuAction('delete')
  assert.equal(filePage.deleteOpen.value, false, '实例重置后旧菜单目标失效')
  filePage.fileView.value = 'list'
  filePage.setSort('name')
  await filePage.loadList('/')
  console.log('通过：菜单键盘/触屏定位、边缘坐标、过期关闭事件、切换及刷新失效、加载占位不展示旧文件')

  filePage.selectedNames.value = ['a.txt']
  filePage.createOpen.value = true
  filePage.createName.value = 'old.txt'
  filePage.previewTarget.value = fileEntry(targetA)
  filePage.previewOpen.value = true
  filePage.deleteOpen.value = true
  filePage.keyword.value = '旧目录'
  const pendingList = filePage.loadList('/late-list')
  const pendingBrowse = filePage.loadTransferBrowseList('/late-browse')
  const pendingCreate = filePage.submitCreate()
  const largeFile = new File([new Uint8Array(128 * 1024 + 1)], 'test.bin')
  const pendingUpload = filePage.uploadFiles([largeFile, new File(['tail'], 'tail.txt')])
  await settle()
  same(filePage.uploadTasks.value.map(task => task.status), ['uploading', 'queued'])
  assert.equal(filePage.uploadSummary.value.pending, 2)
  const oldUploadTask = filePage.uploadTasks.value[0]
  const staleUpload = xhrRequests.at(-1)
  const xhrBeforeSwitch = xhrRequests.length
  await save(targetB)
  await filePage.refreshInstance()
  await settle()
  assert.equal(filePage.path.value, '/')
  assert.equal(filePage.items.value[0].name, 'b.txt')
  same(filePage.selectedNames.value, [])
  assert.equal(filePage.previewTarget.value, null)
  assert.equal(filePage.previewOpen.value, false)
  assert.equal(filePage.deleteOpen.value, false)
  assert.equal(filePage.createOpen.value, false)
  assert.equal(filePage.keyword.value, '')
  assert.equal(staleUpload.aborted, true)
  filePage.createOpen.value = true
  delayedList.resolve({ path: '/late-list', items: [fileEntry(targetA)], total: 1 })
  delayedBrowse.resolve({ path: '/late-browse', items: [{ ...fileEntry(targetA), kind: 'directory' }], total: 1 })
  delayedCreate.resolve({ ok: true })
  await Promise.all([pendingList, pendingBrowse, pendingCreate, pendingUpload])
  assert.equal(filePage.path.value, '/')
  assert.equal(filePage.items.value[0].name, 'b.txt')
  assert.equal(filePage.createOpen.value, true, '旧实例的创建结果不能关闭新实例的对话框')
  same(filePage.transferBrowseList.value, [])
  assert.equal(xhrRequests.length, xhrBeforeSwitch, '切换后不能发送剩余分块或下一个文件')
  assert.equal(filePage.uploading.value, false)
  assert.equal(oldUploadTask.status, 'cancelled')
  staleUpload.progressListeners.get('progress')?.({ lengthComputable: true, loaded: 100 })
  same(filePage.uploadTasks.value, [], '切换实例后不残留旧实例的上传记录')

  filePage.path.value = '/upload-destination'
  const fixedPathUpload = filePage.uploadFiles([largeFile])
  await settle()
  const firstChunk = xhrRequests.at(-1)
  filePage.path.value = '/browsing-other-directory'
  firstChunk.complete()
  await settle()
  const finalChunk = xhrRequests.at(-1)
  assert.notEqual(firstChunk, finalChunk)
  const uploadTarget = new URL(finalChunk.url, 'https://api.example').searchParams
  assert.equal(uploadTarget.get('path'), '/upload-destination')
  assert.equal(uploadTarget.get('uuid'), targetB.instanceUuid)
  finalChunk.progressListeners.get('progress')?.({ lengthComputable: true, loaded: 1 })
  assert.equal(filePage.uploadTasks.value[0].percent, 99, '节点确认前不能显示 100%')
  assert.equal(filePage.uploadTasks.value[0].status, 'finalizing')
  assert.equal(filePage.uploadTasks.value[0].path, '/upload-destination', '队列显示实际上传目录，不跟随浏览目录变化')
  finalChunk.complete()
  await fixedPathUpload
  assert.equal(filePage.uploadTasks.value[0].status, 'success')
  assert.equal(filePage.uploadTasks.value[0].percent, 100)
  const cancelPending = filePage.uploadFiles([largeFile])
  await settle()
  const cancelledCount = xhrRequests.length
  xhrRequests.at(-1).complete()
  filePage.cancelUpload()
  await cancelPending
  assert.equal(xhrRequests.length, cancelledCount, '两块之间取消也不能继续发送')
  console.log('通过：文件页无实例选择、忽略地址栏覆盖、旧目录及操作结果丢弃、切换取消上传、上传目录固定')

  for (const invalidReply of ['<html>代理错误</html>', '{"ok":true}', '{"ok":true,"complete":false,"uploaded":3}']) {
    const toastStart = toasts.length
    const rejectedUpload = filePage.uploadFiles([new File(['abc'], 'unconfirmed.txt')])
    await settle()
    const request = xhrRequests.at(-1)
    request.responseText = invalidReply
    request.complete()
    await rejectedUpload
    assert.equal(filePage.uploadTasks.value.at(-1).status, 'error')
    assert.match(filePage.uploadTasks.value.at(-1).message, /未确认/)
    assert.ok(toasts.slice(toastStart).some(([message, type]) => type === 'error' && message.includes('未确认')))
    assert.equal(toasts.slice(toastStart).some(([message]) => message === 'unconfirmed.txt 已上传'), false)
  }
  console.log('通过：上传进度等待节点确认，HTTP 200 的异常页面或不完整确认不能误报成功')

  const checkedName = (request, existing = null) => ({
    name: request.query.name, path: request.query.path + '/' + request.query.name, existing,
  })
  const conflictFile = { name: 'duplicate.txt', type: 1, size: 12 }
  const leaveGuards = () => windowListeners.get('beforeunload')?.size || 0
  const attemptToLeave = () => {
    const event = { defaultPrevented: false, returnValue: undefined, preventDefault() { this.defaultPrevented = true } }
    for (const handler of windowListeners.get('beforeunload') || []) handler(event)
    return event
  }
  assert.equal(leaveGuards(), 0)
  filePage.clearFinishedUploads()
  same(filePage.uploadTasks.value, [])
  uploadCheckHook = request => checkedName(request, conflictFile)
  let conflictStart = xhrRequests.length
  const replacing = filePage.uploadFiles([new File(['abc'], 'duplicate.txt')])
  assert.equal(leaveGuards(), 1, '开始上传时立即注册原生离开提醒')
  await settle()
  assert.equal(xhrRequests.length, conflictStart, '确认前不发送文件分块')
  assert.equal(filePage.uploadConflict.value.existing.name, 'duplicate.txt')
  assert.equal(filePage.uploadTasks.value.at(-1).status, 'conflict')
  assert.equal(attemptToLeave().defaultPrevented, true, '等待同名确认期间仍提醒离开')
  assert.equal(attemptToLeave().returnValue, '')
  filePage.confirmUploadReplacement()
  await settle()
  let chosenUpload = xhrRequests.at(-1)
  attemptToLeave()
  assert.equal(chosenUpload.aborted, false, '仅弹出离开提醒不能中断正在进行的上传')
  assert.equal(new URL(chosenUpload.url, 'https://api.example').searchParams.get('overwrite'), '1')
  chosenUpload.complete()
  await replacing
  assert.equal(leaveGuards(), 0, '上传完成后移除离开提醒')
  assert.equal(attemptToLeave().defaultPrevented, false)

  const numberedChecks = []
  uploadCheckHook = request => {
    numberedChecks.push(request.query.name)
    return checkedName(request, ['duplicate.txt', 'duplicate (1).txt', 'duplicate (2).txt'].includes(request.query.name)
    ? { ...conflictFile, name: request.query.name } : null)
  }
  conflictStart = xhrRequests.length
  const renamingUpload = filePage.uploadFiles([new File(['abc'], 'duplicate.txt')])
  await settle()
  filePage.confirmUploadRename()
  await settle()
  assert.equal(filePage.uploadConflict.value, null, '选择自动改名后递增编号，不再重复询问')
  same(numberedChecks, ['duplicate.txt', 'duplicate (1).txt', 'duplicate (2).txt', 'duplicate (3).txt'])
  chosenUpload = xhrRequests.at(-1)
  const renamedQuery = new URL(chosenUpload.url, 'https://api.example').searchParams
  assert.equal(renamedQuery.get('name'), 'duplicate (3).txt')
  assert.equal(renamedQuery.get('overwrite'), '0')
  chosenUpload.complete()
  await renamingUpload
  assert.equal(filePage.uploadTasks.value.at(-1).name, 'duplicate (3).txt')
  assert.equal(filePage.uploadTasks.value.at(-1).originalName, 'duplicate.txt')
  assert.ok(toasts.some(([message]) => message === 'duplicate (3).txt 已上传'))
  for (const [original, expected] of [
    ['文件.txt', '文件 (1).txt'], ['文件 (1).txt', '文件 (2).txt'], ['文件 (9).txt', '文件 (10).txt'],
    ['README', 'README (1)'], ['.env', '.env (1)'], ['文件 (副本).txt', '文件 (副本) (1).txt'],
    ['文件 (9007199254740993).txt', '文件 (9007199254740994).txt'],
  ]) assert.equal(filePage.suggestUploadName(original), expected)
  assert.ok(filePage.suggestUploadName('x'.repeat(196) + '.txt').length <= 200)
  assert.throws(() => filePage.suggestUploadName('x.' + 'a'.repeat(198)), /过长/)
  console.log('通过：自动编号改名、连续冲突递增、扩展名和现有编号保留、文件名长度边界')

  uploadCheckHook = request => checkedName(request, { ...conflictFile, name: request.query.name })
  const batch = filePage.uploadFiles([new File(['a'], 'first.txt'), new File(['b'], 'second.txt')])
  await settle()
  filePage.confirmUploadReplacement()
  await settle()
  xhrRequests.at(-1).complete()
  const firstCount = xhrRequests.length
  await settle()
  assert.equal(filePage.uploadConflict.value.existing.name, 'second.txt')
  assert.equal(leaveGuards(), 1, '批次中途等待下一份文件确认时仍保护页面')
  assert.equal(xhrRequests.length, firstCount, '上一个文件的替换确认不能自动应用到下一个文件')
  filePage.cancelUpload()
  await batch
  assert.equal(filePage.uploadConflict.value, null)
  assert.equal(leaveGuards(), 0, '取消整个批次后移除离开提醒')

  for (const action of ['rename', 'replace']) {
    const occupied = new Set(['batch-a.txt', 'batch-b.txt', 'batch-a (1).txt'])
    uploadCheckHook = request => checkedName(request, occupied.has(request.query.name)
      ? { ...conflictFile, name: request.query.name } : null)
    const rememberedBatch = filePage.uploadFiles([
      new File(['a'], 'batch-a.txt'), new File(['b'], 'batch-b.txt'), new File(['c'], 'fresh.txt'),
    ])
    await settle()
    assert.equal(filePage.uploadApplyToRemaining.value, false, '复选框默认不勾选')
    filePage.uploadApplyToRemaining.value = true
    if (action === 'rename') filePage.confirmUploadRename()
    else filePage.confirmUploadReplacement()
    await settle()
    for (const [index, expectedName] of (action === 'rename'
      ? ['batch-a (2).txt', 'batch-b (1).txt', 'fresh.txt']
      : ['batch-a.txt', 'batch-b.txt', 'fresh.txt']).entries()) {
      assert.equal(filePage.uploadConflict.value, null, '勾选后本批次不再询问相同冲突')
      const request = xhrRequests.at(-1)
      const query = new URL(request.url, 'https://api.example').searchParams
      assert.equal(query.get('name'), expectedName)
      assert.equal(query.get('overwrite'), action === 'replace' && index < 2 ? '1' : '0')
      const count = xhrRequests.length
      request.complete()
      await settle()
      if (index < 2) assert.equal(xhrRequests.length, count + 1)
    }
    await rememberedBatch
    assert.equal(leaveGuards(), 0)
    const nextBatchCount = xhrRequests.length
    const nextBatch = filePage.uploadFiles([new File(['a'], 'batch-a.txt')])
    await settle()
    assert.ok(filePage.uploadConflict.value, '新批次必须再次询问，不能继承上一批替换许可')
    assert.equal(filePage.uploadApplyToRemaining.value, false)
    assert.equal(xhrRequests.length, nextBatchCount)
    filePage.cancelUpload()
    await nextBatch
  }
  console.log('通过：勾选后整批自动替换或编号改名，无冲突文件正常上传，新批次重置选择')

  uploadCheckHook = request => checkedName(request, ['file.txt', 'folder'].includes(request.query.name)
    ? { name: request.query.name, type: request.query.name === 'folder' ? 0 : 1, size: 0 } : null)
  const mixedBatch = filePage.uploadFiles([new File(['a'], 'file.txt'), new File(['b'], 'folder')])
  await settle()
  filePage.uploadApplyToRemaining.value = true
  filePage.confirmUploadReplacement()
  await settle()
  xhrRequests.at(-1).complete()
  const mixedCount = xhrRequests.length
  await settle()
  assert.equal(filePage.uploadConflict.value.existing.type, 0, '记住替换后遇到目录仍需单独询问')
  filePage.confirmUploadReplacement()
  assert.equal(xhrRequests.length, mixedCount)
  filePage.confirmUploadRename()
  await settle()
  const directoryRename = new URL(xhrRequests.at(-1).url, 'https://api.example').searchParams
  assert.equal(directoryRename.get('name'), 'folder (1)')
  assert.equal(directoryRename.get('overwrite'), '0')
  xhrRequests.at(-1).complete()
  await mixedBatch

  uploadCheckHook = request => checkedName(request, { name: request.query.name, type: 0, size: 0 })
  conflictStart = xhrRequests.length
  const directoryConflict = filePage.uploadFiles([new File(['abc'], 'folder')])
  await settle()
  assert.equal(filePage.uploadConflict.value.existing.type, 0)
  filePage.confirmUploadReplacement()
  assert.equal(xhrRequests.length, conflictStart, '同名目录不能替换')
  filePage.cancelUpload()
  await directoryConflict

  let raceDetected = false
  uploadCheckHook = request => checkedName(request, raceDetected ? conflictFile : null)
  const racedUpload = filePage.uploadFiles([new File(['abc'], 'duplicate.txt')])
  await settle()
  const racedRequest = xhrRequests.at(-1)
  raceDetected = true
  racedRequest.status = 409
  racedRequest.responseText = JSON.stringify({ statusMessage: '同名冲突', data: { code: 'MCSM_UPLOAD_CONFLICT' } })
  racedRequest.complete()
  await settle()
  assert.equal(filePage.uploadConflict.value.existing.name, 'duplicate.txt')
  filePage.confirmUploadReplacement()
  await settle()
  const retriedRequest = xhrRequests.at(-1)
  assert.notEqual(new URL(racedRequest.url, 'https://api.example').searchParams.get('uploadId'),
    new URL(retriedRequest.url, 'https://api.example').searchParams.get('uploadId'))
  retriedRequest.complete()
  await racedUpload
  console.log('通过：批量冲突逐个确认、同名目录只允许改名、上传期间新冲突重新确认')

  const raceNames = new Set(['duplicate.txt'])
  uploadCheckHook = request => checkedName(request, raceNames.has(request.query.name)
    ? { ...conflictFile, name: request.query.name } : null)
  const racedRename = filePage.uploadFiles([new File(['abc'], 'duplicate.txt')])
  await settle()
  filePage.confirmUploadRename()
  await settle()
  const numberedRace = xhrRequests.at(-1)
  assert.equal(new URL(numberedRace.url, 'https://api.example').searchParams.get('name'), 'duplicate (1).txt')
  raceNames.add('duplicate (1).txt')
  numberedRace.status = 409
  numberedRace.responseText = JSON.stringify({ statusMessage: '同名冲突', data: { code: 'MCSM_UPLOAD_CONFLICT' } })
  numberedRace.complete()
  await settle()
  assert.equal(filePage.uploadConflict.value, null, '编号被抢先占用后继续递增，不重新询问当前文件')
  const nextNumberedQuery = new URL(xhrRequests.at(-1).url, 'https://api.example').searchParams
  assert.equal(nextNumberedQuery.get('name'), 'duplicate (2).txt')
  assert.equal(nextNumberedQuery.get('overwrite'), '0')
  xhrRequests.at(-1).complete()
  await racedRename
  assert.equal(leaveGuards(), 0)
  console.log('通过：自动改名遇到落盘竞态继续递增编号，始终不覆盖原文件')

  uploadCheckHook = request => checkedName(request, conflictFile)
  conflictStart = xhrRequests.length
  const switchedConflict = filePage.uploadFiles([new File(['abc'], 'duplicate.txt')])
  await settle()
  await save(targetA)
  await filePage.refreshInstance()
  await switchedConflict
  assert.equal(filePage.uploadConflict.value, null)
  assert.equal(xhrRequests.length, conflictStart)
  assert.equal(leaveGuards(), 0, '实例切换取消批次后移除离开提醒')
  const delayedCheck = deferred()
  let delayedCheckRequest
  uploadCheckHook = request => { delayedCheckRequest = request; return delayedCheck.promise }
  const switchedCheck = filePage.uploadFiles([new File(['abc'], 'duplicate.txt')])
  await settle()
  await save(targetB)
  await filePage.refreshInstance()
  assert.equal(delayedCheckRequest.signal.aborted, true)
  delayedCheck.resolve(checkedName(delayedCheckRequest, conflictFile))
  await switchedCheck
  assert.equal(filePage.uploadConflict.value, null, '实例切换后迟到的检查结果不能重新打开弹窗')
  assert.equal(xhrRequests.length, conflictStart)
  assert.equal(leaveGuards(), 0)
  uploadCheckHook = undefined
  console.log('通过：取消确认与实例切换会结束等待，旧检查结果不影响新实例')
  console.log('通过：上传及等待确认时触发 beforeunload 原生确认，完成、失败、取消或切换后不再提醒')

  filePage.clearFinishedUploads()
  filePage.path.value = '/queue-destination'
  const queueUpload = filePage.uploadFiles([
    largeFile, new File(['bad'], '失败.txt'), new File([], '空文件.txt'), new File(['tail'], '最后一个.txt'),
  ])
  await settle()
  same(filePage.uploadTasks.value.map(task => task.status), ['uploading', 'queued', 'queued', 'queued'])
  same(filePage.uploadSummary.value, { total: 4, success: 0, failed: 0, cancelled: 0, pending: 4 })
  const queueFirstChunk = xhrRequests.at(-1)
  queueFirstChunk.progressListeners.get('progress')?.({ lengthComputable: true, loaded: 65536 })
  assert.equal(filePage.uploadTasks.value[0].percent, 50)
  assert.equal(filePage.uploadTasks.value[1].percent, 0, '只更新当前文件的进度')
  const activeQueueLength = filePage.uploadTasks.value.length
  const activeRequestCount = xhrRequests.length
  await filePage.uploadFiles([new File(['extra'], 'extra.txt')])
  assert.equal(filePage.uploadTasks.value.length, activeQueueLength, '进行中的批次不能被新批次覆盖')
  assert.equal(xhrRequests.length, activeRequestCount)
  queueFirstChunk.complete()
  await settle()
  xhrRequests.at(-1).complete()
  await settle()
  const completedQueueTask = filePage.uploadTasks.value[0]
  assert.equal(completedQueueTask.status, 'success')
  assert.equal(completedQueueTask.percent, 100)
  assert.equal(filePage.finishedUploadCount.value, 1)
  assert.equal(filePage.orderedUploadTasks.value[0].name, '失败.txt', '进行中任务显示在已完成记录之前')
  assert.equal(filePage.orderedUploadTasks.value.at(-1).id, completedQueueTask.id)
  filePage.clearFinishedUploads()
  same(filePage.uploadTasks.value.map(task => task.status), ['uploading', 'queued', 'queued'])
  assert.equal(filePage.uploading.value, true, '清除结束记录不能中断当前批次')
  const failedQueueTask = filePage.uploadTasks.value[0]
  const failedQueueRequest = xhrRequests.at(-1)
  failedQueueRequest.listeners.get('error')?.()
  await settle()
  assert.equal(failedQueueTask.status, 'error')
  assert.match(failedQueueTask.message, /网络中断/)
  assert.equal(filePage.uploadTasks.value[1].status, 'finalizing', '失败后继续处理下一个空文件')
  failedQueueRequest.progressListeners.get('progress')?.({ lengthComputable: true, loaded: 3 })
  assert.equal(failedQueueTask.status, 'error', '迟到的进度事件不能覆盖失败结果')
  assert.equal(failedQueueTask.percent, 0)
  assert.equal(leaveGuards(), 1)
  const emptyQueueRequest = xhrRequests.at(-1)
  assert.equal(new URL(emptyQueueRequest.url, 'https://api.example').searchParams.get('total'), '0')
  emptyQueueRequest.complete()
  await settle()
  assert.equal(filePage.uploadTasks.value[1].status, 'success')
  assert.equal(filePage.uploadTasks.value[1].percent, 100)
  filePage.path.value = '/different-browser-directory'
  assert.equal(new URL(xhrRequests.at(-1).url, 'https://api.example').searchParams.get('path'), '/queue-destination')
  xhrRequests.at(-1).complete()
  await queueUpload
  same(filePage.uploadTasks.value.map(task => task.status), ['error', 'success', 'success'])
  same(filePage.uploadSummary.value, { total: 3, success: 2, failed: 1, cancelled: 0, pending: 0 })
  assert.equal(leaveGuards(), 0)
  console.log('通过：独立上传队列逐文件进度、清除完成记录不影响上传、失败保留原因并继续、空文件确认与结果汇总')

  filePage.clearFinishedUploads()
  const cancellingQueue = filePage.uploadFiles([new File(['abc'], '正在写入.txt'), new File(['wait'], '等待.txt')])
  await settle()
  const finalizingRequest = xhrRequests.at(-1)
  finalizingRequest.progressListeners.get('progress')?.({ lengthComputable: true, loaded: 3 })
  assert.equal(filePage.uploadTasks.value[0].status, 'finalizing')
  assert.equal(filePage.uploadTasks.value[0].percent, 99)
  const beforeQueueCancel = xhrRequests.length
  filePage.cancelUpload()
  await cancellingQueue
  same(filePage.uploadTasks.value.map(task => task.status), ['cancelled', 'cancelled'])
  assert.match(filePage.uploadTasks.value[0].message, /服务器可能仍在写入/)
  assert.match(filePage.uploadTasks.value[1].message, /未开始/)
  assert.equal(filePage.uploadSummary.value.pending, 0)
  assert.equal(filePage.uploadSummary.value.cancelled, 2)
  assert.equal(xhrRequests.length, beforeQueueCancel)
  assert.equal(finalizingRequest.aborted, true)
  assert.equal(leaveGuards(), 0)
  const beforeClearRequests = pageRequests.length
  filePage.clearFinishedUploads()
  same(filePage.uploadTasks.value, [])
  assert.equal(pageRequests.length, beforeClearRequests, '清除记录不得发起删除服务器文件的请求')
  const beforeOversized = xhrRequests.length
  await filePage.uploadFiles([{ name: 'oversized.bin', size: 256 * 1024 * 1024 + 1 }])
  assert.equal(xhrRequests.length, beforeOversized)
  same(filePage.uploadTasks.value, [])
  assert.equal(leaveGuards(), 0, '超限文件不会创建卡住的队列或离开提醒')
  console.log('通过：取消标记进行中及等待任务、写入中取消提示不确定性、清空记录不删除远端文件、超限文件不入队')

  uploadCheckHook = request => {
    if (request.query.name === '无权限.txt') throw error({ statusCode: 403, statusMessage: '文件名检查被拒绝' })
    return checkedName(request)
  }
  const checkFailedBatch = filePage.uploadFiles([new File(['a'], '无权限.txt'), new File(['b'], '正常.txt')])
  await settle()
  same(filePage.uploadTasks.value.map(task => task.status), ['error', 'uploading'])
  assert.match(filePage.uploadTasks.value[0].message, /检查被拒绝/)
  xhrRequests.at(-1).complete()
  await checkFailedBatch
  assert.equal(filePage.uploadSummary.value.pending, 0)
  uploadCheckHook = undefined

  assert.equal(filePage.uploadQueueOpen.value, false, '选择文件上传不会强行展开队列')
  filePage.clearFinishedUploads()
  const dropFiles = files => ({ dataTransfer: { files } })
  await filePage.onDrop(dropFiles([]))
  await filePage.onDrop(dropFiles([{ name: 'oversized-drop.bin', size: 256 * 1024 * 1024 + 1 }]))
  assert.equal(filePage.uploadQueueOpen.value, false, '空拖入或超限文件不展开队列')
  assert.equal(filePage.uploadQueueAutoOpened.value, false)
  browserPermissions.value = { 'server-files': 'view' }
  await filePage.onDrop(dropFiles([new File(['readonly'], '无权限拖入.txt')]))
  assert.equal(filePage.uploadQueueOpen.value, false, '无上传权限的拖入不展开队列')
  browserPermissions.value = fileEditor.permissions
  filePage.toggleUploadQueue()
  assert.equal(filePage.uploadQueueOpen.value, true, '纯图标按钮可展开空队列')
  filePage.toggleUploadQueue()
  assert.equal(filePage.uploadQueueOpen.value, false)
  assert.equal(filePage.uploadQueueAutoOpenDismissed.value, false, '首次拖拽自动展开前仍允许触发自动展开')

  const firstDropUpload = filePage.onDrop(dropFiles([new File(['drop'], '首次拖入.txt')]))
  assert.equal(filePage.uploadQueueOpen.value, true, '有效拖拽上传开始时立即展开队列')
  assert.equal(filePage.uploadQueueAutoOpened.value, true)
  await settle()
  const firstDropRequest = xhrRequests.at(-1)
  filePage.toggleUploadQueue()
  assert.equal(filePage.uploadQueueOpen.value, false)
  assert.equal(filePage.uploadQueueAutoOpenDismissed.value, true)
  assert.equal(filePage.uploading.value, true, '收起队列不能中断上传')
  assert.equal(firstDropRequest.aborted, false)
  assert.equal(leaveGuards(), 1, '收起队列后仍保留关闭页面提醒')
  const busyDropCount = xhrRequests.length
  await filePage.onDrop(dropFiles([new File(['busy'], '忙碌时拖入.txt')]))
  assert.equal(xhrRequests.length, busyDropCount)
  assert.equal(filePage.uploadQueueOpen.value, false, '未被接收的拖入不能重新展开队列')
  firstDropRequest.progressListeners.get('progress')?.({ lengthComputable: true, loaded: 4 })
  assert.equal(filePage.uploadTasks.value[0].percent, 99, '收起后任务进度仍正常更新')
  assert.equal(filePage.uploadQueueOpen.value, false)
  firstDropRequest.complete()
  await firstDropUpload
  filePage.clearFinishedUploads()
  assert.equal(filePage.uploadQueueOpen.value, false, '完成和清除记录都不改变收起状态')
  filePage.toggleUploadQueue()
  assert.equal(filePage.uploadQueueOpen.value, true, '禁止自动展开后仍可手动打开')
  filePage.toggleUploadQueue()
  const laterDropUpload = filePage.onDrop(dropFiles([new File(['later'], '再次拖入.txt')]))
  await settle()
  assert.equal(filePage.uploadQueueOpen.value, false, '手动收起后，后续拖入均不再自动打开')
  xhrRequests.at(-1).complete()
  await laterDropUpload
  await filePage.refreshPage()
  filePage.resetFileState()
  assert.equal(filePage.uploadQueueOpen.value, false)
  assert.equal(filePage.uploadQueueAutoOpenDismissed.value, true, '刷新目录或重置实例数据不重置本次访问的选择')

  const revisitedFilePage = compilePage('app/pages/server-files/index.vue')
  const unmountRevisitedFilePage = cleanup.at(-1)
  await revisitedFilePage.refreshInstance()
  await settle()
  assert.equal(revisitedFilePage.uploadQueueOpen.value, false, '重新进入页面仍默认收起')
  assert.equal(revisitedFilePage.uploadQueueAutoOpened.value, false)
  assert.equal(revisitedFilePage.uploadQueueAutoOpenDismissed.value, false, '新的页面实例不继承上次禁止自动展开的选择')
  const revisitedDropUpload = revisitedFilePage.onDrop(dropFiles([new File(['fresh'], '重新进入后拖入.txt')]))
  await settle()
  assert.equal(revisitedFilePage.uploadQueueOpen.value, true, '重新进入后恢复拖拽自动展开')
  xhrRequests.at(-1).complete()
  await revisitedDropUpload
  cleanup.splice(cleanup.indexOf(unmountRevisitedFilePage), 1)
  unmountRevisitedFilePage()
  assert.equal(leaveGuards(), 0)
  console.log('通过：纯图标队列开关、默认收起、有效拖入自动展开、手动收起后本次访问不再自动展开、重新进入后恢复')

  const directoryClient = load('app/utils/directory-upload.ts')
  const relativeFile = (relativePath, content = '文件内容') => Object.defineProperty(
    new File([content], relativePath.split('/').at(-1)), 'webkitRelativePath', { value: relativePath })
  const fileHandle = (name, content = '文件内容') => ({ kind: 'file', name, getFile: async () => new File([content], name) })
  const directoryHandle = (name, children = []) => ({ kind: 'directory', name, async *values() { yield* children } })
  const directoryReply = (request, extra = {}) => ({
    ok: true, name: request.body.name,
    path: (request.body.path === '/' ? '' : request.body.path) + '/' + request.body.name, created: true, ...extra,
  })
  const drainDirectoryUpload = async (pending, firstRequest) => {
    const completed = new Set()
    for (let attempt = 0; attempt < 100 && filePage.uploading.value; attempt++) {
      await settle()
      const requests = xhrRequests.slice(firstRequest).filter(request => !completed.has(request) && !request.aborted)
      assert.ok(requests.length <= 1, '文件和分块始终逐个上传')
      for (const request of requests) { completed.add(request); request.complete() }
    }
    await settle()
    assert.equal(filePage.uploading.value, false, '目录批次应正常完成')
    await pending
    return xhrRequests.slice(firstRequest).map(request => new URL(request.url, 'https://api.example').searchParams)
  }
  for (const invalidPath of ['../escape', '/absolute', 'folder/../escape', 'folder/ . /file', 'folder//file', 'C:/file', 'folder\\file']) {
    assert.throws(() => directoryClient.createUploadPlan([{ kind: 'directory', relativePath: invalidPath }]), /路径/)
  }
  assert.throws(() => directoryClient.createUploadPlan([
    { kind: 'directory', relativePath: 'collision' }, ...directoryClient.filesToUploadItems([new File(['x'], 'collision')]),
  ]), /相同路径/)

  browserPermissions.value = uploadOnly.permissions
  await save(targetA)
  await filePage.refreshInstance()
  await settle()
  await filePage.loadList('/folder-destination')
  filePage.clearFinishedUploads()
  const pickedFolder = deferred()
  context.window.showDirectoryPicker = () => pickedFolder.promise
  const madeDirectoryRequests = []
  uploadDirectoryHook = request => {
    madeDirectoryRequests.push(request)
    return directoryReply(request, request.body.name === 'config'
      ? { name: 'CONFIG', path: request.body.path + '/CONFIG', created: false }
      : request.body.name === '整合包' ? { created: false } : {})
  }
  const beforeFolderFiles = xhrRequests.length
  const folderUpload = filePage.pickDirectory()
  assert.equal(filePage.uploadPreparing.value, true)
  assert.equal(leaveGuards(), 1, '目录读取阶段也可以取消，并保留离开提醒')
  filePage.uploadQueueOpen.value = true
  const preparingMarkup = (await renderFilePage()).html
  const preparingToolbar = preparingMarkup.match(/<div class="file-tools">([\s\S]*?)<\/div>/)?.[1]
  assert.ok(preparingToolbar, '实际模板中存在文件工具栏')
  assert.match(preparingToolbar, /上传文件夹/)
  assert.match(preparingMarkup, /正在读取文件夹/)
  assert.doesNotMatch(preparingToolbar, /新建目录|新建文件/, '只有上传权限仍能上传目录，但不能使用新建操作')
  filePage.path.value = '/browse-while-reading'
  pickedFolder.resolve(directoryHandle('整合包', [
    directoryHandle('config', [fileHandle('same.txt')]),
    directoryHandle('mods', [fileHandle('same.txt')]), directoryHandle('空目录'), fileHandle('说明.txt'),
  ]))
  const folderFileQueries = await drainDirectoryUpload(folderUpload, beforeFolderFiles)
  same(madeDirectoryRequests.map(request => [request.body.path, request.body.name]), [
    ['/folder-destination', '整合包'], ['/folder-destination/整合包', 'config'],
    ['/folder-destination/整合包', 'mods'], ['/folder-destination/整合包', '空目录'],
  ])
  same(folderFileQueries.map(query => [query.get('path'), query.get('name')]), [
    ['/folder-destination/整合包/CONFIG', 'same.txt'], ['/folder-destination/整合包/mods', 'same.txt'],
    ['/folder-destination/整合包', '说明.txt'],
  ])
  assert.equal(filePage.uploadTasks.value.length, 7, '根目录、子目录、空目录和文件分别记录')
  assert.ok(filePage.uploadTasks.value.every(task => task.status === 'success' && task.percent === 100))
  assert.match(filePage.uploadTasks.value[1].message, /合并/)
  assert.equal(filePage.path.value, '/browse-while-reading', '读取和上传期间浏览其他目录不会改变目标')
  assert.equal(filePage.uploadPreparing.value, false)
  assert.equal(leaveGuards(), 0)

  delete context.window.showDirectoryPicker
  uploadDirectoryHook = undefined
  let folderPickerClicks = 0
  filePage.directoryInput.value = { click: () => { folderPickerClicks++ } }
  filePage.pickDirectory()
  assert.equal(folderPickerClicks, 1, '不支持目录句柄时回退到目录选择输入框')
  assert.match((await renderFilePage()).html, /webkitdirectory/)
  await filePage.loadList('/picker-destination')
  filePage.clearFinishedUploads()
  const directoryInput = { files: [relativeFile('world/data/chunk.dat'), relativeFile('world/region/chunk.dat')], value: '已选目录' }
  const beforeFallbackFiles = xhrRequests.length
  const fallbackUpload = filePage.onDirectoryPicked({ target: directoryInput })
  assert.equal(directoryInput.value, '', '相同文件夹允许再次选择')
  const fallbackQueries = await drainDirectoryUpload(fallbackUpload, beforeFallbackFiles)
  same(fallbackQueries.map(query => query.get('path')), ['/picker-destination/world/data', '/picker-destination/world/region'])
  assert.equal(filePage.uploadTasks.value.filter(task => task.kind === 'directory').length, 3)

  const droppedFile = name => ({ name, isFile: true, isDirectory: false, file: resolve => queueMicrotask(() => resolve(new File(['x'], name))) })
  const readerCounts = new Map()
  const droppedDirectory = (name, batches = []) => ({ name, isFile: false, isDirectory: true, createReader() {
    const remaining = [...batches, []]
    return { readEntries(resolve) {
      readerCounts.set(name, (readerCounts.get(name) || 0) + 1)
      queueMicrotask(() => resolve(remaining.shift() || []))
    } }
  } })
  const droppedTransfer = entries => ({ files: [], items: entries.map(entry => ({
    kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => null,
  })) })
  const pagedFolder = droppedDirectory('paged', [
    Array.from({ length: 100 }, (_, index) => droppedFile(`file-${index}.txt`)),
    [droppedFile('file-100.txt'), droppedDirectory('empty')],
  ])
  const transfer = droppedTransfer([pagedFolder])
  const readingDrop = directoryClient.readDroppedUploads(transfer, () => true)
  transfer.items = []
  const readDrop = await readingDrop
  assert.equal(readDrop.filter(item => item.kind === 'file').length, 101, '拖入目录必须读完多批条目')
  assert.ok(readDrop.some(item => item.relativePath === 'paged/empty' && item.kind === 'directory'))
  assert.equal(readerCounts.get('paged'), 3)
  filePage.clearFinishedUploads()
  const beforeDroppedFiles = xhrRequests.length
  const droppedBatch = filePage.onDrop({ dataTransfer: droppedTransfer([
    droppedDirectory('dropped', [[droppedDirectory('empty-child'), droppedFile('payload.txt')]]),
  ]) })
  const droppedQueries = await drainDirectoryUpload(droppedBatch, beforeDroppedFiles)
  assert.equal(droppedQueries[0].get('path'), '/picker-destination/dropped')
  assert.ok(filePage.uploadTasks.value.some(task => task.kind === 'directory' && task.name === 'empty-child' && task.status === 'success'))
  console.log('通过：目录选择及回退、多层目录与空目录、目录合并、同名文件分目录上传、目标固定和拖放分批读取')

  // 目录上传的异常与取消检查。
  await filePage.loadList('/directory-failures')
  filePage.clearFinishedUploads()
  const failedDirectoryRequests = []
  uploadDirectoryHook = request => {
    failedDirectoryRequests.push(request.body.name)
    if (request.body.name === 'blocked') throw error({ statusCode: 409, statusMessage: '同名文件占用了目录' })
    return directoryReply(request)
  }
  const beforeFailedDirectoryFiles = xhrRequests.length
  const failedDirectoryBatch = filePage.uploadFiles([
    relativeFile('blocked/child/skipped.txt'), relativeFile('good/uploaded.txt'), new File(['loose'], 'loose.txt'),
  ], 'directory')
  const continuedFiles = await drainDirectoryUpload(failedDirectoryBatch, beforeFailedDirectoryFiles)
  same(continuedFiles.map(query => [query.get('path'), query.get('name')]), [
    ['/directory-failures/good', 'uploaded.txt'], ['/directory-failures', 'loose.txt'],
  ])
  same(failedDirectoryRequests, ['blocked', 'good'], '失败目录的子目录不能继续发送创建请求')
  assert.equal(filePage.uploadSummary.value.failed, 3)
  assert.equal(filePage.uploadTasks.value.find(task => task.name === 'skipped.txt').status, 'error')
  assert.match(filePage.uploadTasks.value.find(task => task.name === 'skipped.txt').message, /父文件夹/)
  filePage.clearFinishedUploads()
  uploadDirectoryHook = request => directoryReply(request, { path: '/unexpected' })
  const beforeUnconfirmedDirectory = xhrRequests.length
  await filePage.uploadFiles([relativeFile('unconfirmed/file.txt')], 'directory')
  assert.equal(xhrRequests.length, beforeUnconfirmedDirectory, '未确认正确目录之前不能上传子文件')
  assert.ok(filePage.uploadTasks.value.every(task => task.status === 'error'))

  uploadDirectoryHook = undefined
  filePage.clearFinishedUploads()
  await filePage.loadList('/folder-conflicts')
  uploadCheckHook = request => checkedName(request, request.query.name === 'duplicate.txt'
    ? { name: 'duplicate.txt', type: 1, size: 9 } : null)
  const beforeNestedConflict = xhrRequests.length
  const nestedConflict = filePage.uploadFiles([
    relativeFile('Pack/a/duplicate.txt'), relativeFile('Pack/b/duplicate.txt'),
  ], 'directory')
  await settle()
  assert.equal(filePage.uploadConflict.value.path, '/folder-conflicts/Pack/a')
  filePage.uploadApplyToRemaining.value = true
  filePage.confirmUploadRename()
  const renamedNestedFiles = await drainDirectoryUpload(nestedConflict, beforeNestedConflict)
  same(renamedNestedFiles.map(query => [query.get('path'), query.get('name'), query.get('overwrite')]), [
    ['/folder-conflicts/Pack/a', 'duplicate (1).txt', '0'], ['/folder-conflicts/Pack/b', 'duplicate (1).txt', '0'],
  ])
  uploadCheckHook = undefined

  filePage.clearFinishedUploads()
  const delayedDirectory = deferred()
  let delayedDirectoryRequest
  uploadDirectoryHook = request => { delayedDirectoryRequest = request; return delayedDirectory.promise }
  const beforeCancelledDirectory = xhrRequests.length
  const cancelledDirectory = filePage.uploadFiles([relativeFile('cancelled/child/file.txt')], 'directory')
  await settle()
  assert.equal(filePage.uploadTasks.value[0].status, 'creating')
  filePage.cancelUpload()
  assert.equal(delayedDirectoryRequest.signal.aborted, true)
  assert.ok(filePage.uploadTasks.value.every(task => task.status === 'cancelled'))
  assert.match(filePage.uploadTasks.value[0].message, /可能已创建/)
  filePage.clearFinishedUploads()
  const replacementBatch = filePage.uploadFiles([new File(['new'], 'after-cancel.txt')])
  await settle()
  delayedDirectory.resolve(directoryReply(delayedDirectoryRequest))
  await cancelledDirectory
  assert.equal(filePage.uploading.value, true, '旧目录响应不得关闭后续新批次')
  assert.equal(xhrRequests.length, beforeCancelledDirectory + 1, '取消后不会继续上传原目录的文件')
  xhrRequests.at(-1).complete()
  await replacementBatch
  uploadDirectoryHook = undefined

  for (const interruption of ['cancel', 'switch']) {
    filePage.clearFinishedUploads()
    const delayedRead = deferred()
    context.window.showDirectoryPicker = async () => directoryHandle('reading', [{
      kind: 'file', name: 'delayed.txt', getFile: () => delayedRead.promise,
    }])
    const beforeReadUploads = xhrRequests.length
    const beforeReadDirectories = pageRequests.filter(request => request.url.endsWith('/upload-directory')).length
    const readingDirectory = filePage.pickDirectory()
    await settle()
    assert.equal(filePage.uploadPreparing.value, true)
    if (interruption === 'cancel') filePage.cancelUpload()
    else { await save(targetB); await filePage.refreshInstance(); await settle() }
    delayedRead.resolve(new File(['old'], 'delayed.txt'))
    await readingDirectory
    assert.equal(xhrRequests.length, beforeReadUploads)
    assert.equal(pageRequests.filter(request => request.url.endsWith('/upload-directory')).length, beforeReadDirectories)
    assert.equal(filePage.uploadPreparing.value, false)
    assert.equal(filePage.uploading.value, false)
    if (interruption === 'switch') { await save(targetA); await filePage.refreshInstance(); await settle() }
  }
  const beforePickerCancelToasts = toasts.length
  context.window.showDirectoryPicker = async () => { throw Object.assign(new Error('取消选择'), { name: 'AbortError' }) }
  await filePage.pickDirectory()
  assert.equal(toasts.length, beforePickerCancelToasts, '取消目录选择不报错')
  assert.equal(leaveGuards(), 0)
  browserPermissions.value = fileViewer.permissions
  let unauthorizedPickerCalls = 0
  context.window.showDirectoryPicker = async () => { unauthorizedPickerCalls++; return directoryHandle('denied') }
  await filePage.pickDirectory()
  assert.equal(unauthorizedPickerCalls, 0, '无上传权限不能打开目录上传入口')
  delete context.window.showDirectoryPicker
  browserPermissions.value = fileEditor.permissions
  filePage.directoryInput.value = null
  await save(targetB)
  await filePage.refreshInstance()
  await settle()
  console.log('通过：目录失败阻断子项、嵌套文件冲突策略、创建期间取消、迟到响应隔离、扫描期间取消/切换与权限')

  await filePage.loadList('/')
  const leavingMenuEntry = filePage.items.value[0]
  const leavingUpload = filePage.uploadFiles([new File(['leave'], '离开页面.txt')])
  await settle()
  const leavingRequest = xhrRequests.at(-1)
  assert.equal(leaveGuards(), 1)
  openMenu(leavingMenuEntry)
  assert.ok(filePage.fileMenu.value)
  cleanup.splice(cleanup.indexOf(unmountFilePage), 1)
  unmountFilePage()
  await leavingUpload
  assert.equal(leavingRequest.aborted, true)
  same(filePage.uploadTasks.value, [])
  assert.equal(leaveGuards(), 0, '页面卸载时移除原生离开提醒')
  assert.equal(filePage.fileMenu.value, null, '页面卸载关闭右键菜单')
  openMenu(leavingMenuEntry)
  assert.equal(filePage.fileMenu.value, null, '离开后的事件不能重新打开菜单')
  console.log('通过：检查失败不阻塞后续文件，页面卸载取消上传、清空队列并解除离开提醒')

  browserRoute.query = { uuid: targetA.instanceUuid, daemonId: targetA.daemonId, path: '/test.txt', kind: 'text' }
  const previewPage = compilePage('app/pages/server-files/preview.vue')
  const previewBinding = bindingStates.at(-1)
  await previewBinding.refreshInstance()
  assert.equal(previewPage.ready.value, false)
  assert.match(previewPage.previewError.value, /失效/)
  browserRoute.query = { uuid: targetB.instanceUuid, daemonId: targetB.daemonId, path: '/test.txt', kind: 'text' }
  assert.equal(previewPage.ready.value, true)
  await save(targetA)
  await previewBinding.refreshInstance()
  assert.equal(previewPage.ready.value, false)
  await save(null)
  await filePage.refreshInstance()
  await previewBinding.refreshInstance()
  assert.equal(filePage.instance.value, null)
  assert.equal(previewPage.ready.value, false)
  browserFetch = async () => { throw error({ statusCode: 503, statusMessage: '模拟面板离线' }) }
  await filePage.refreshInstance()
  assert.equal(filePage.instance.value, null)
  assert.equal(filePage.loadError.value, '模拟面板离线')
  console.log('通过：独立预览核对绑定、旧链接失效、取消绑定与面板异常关闭操作入口')

  const textRequests = []
  let saveRequest
  browserFetch = async (url, request) => {
    assert.equal(url, '/api/admin/mcsm/file')
    const pending = deferred()
    if (request.method === 'PUT') saveRequest = { ...pending, request }
    else textRequests.push({ ...pending, request })
    return pending.promise
  }
  const previewProps = vue.reactive({ uuid: targetA.instanceUuid, daemonId: targetA.daemonId, path: '/same.txt', kind: 'text', canEdit: true })
  const savedEvents = []
  const preview = compilePage('app/components/FilePreview.vue', previewProps, savedEvents)
  previewProps.uuid = targetB.instanceUuid
  previewProps.daemonId = targetB.daemonId
  textRequests.at(-1).resolve({ text: '新实例文本', truncated: false })
  await settle()
  for (const pending of textRequests.slice(0, -1)) pending.resolve({ text: '迟到的旧实例文本', truncated: false })
  await settle()
  assert.equal(preview.text.value, '新实例文本')
  preview.text.value = '已提交的编辑'
  const pendingSave = preview.save()
  preview.text.value = '提交后继续输入'
  saveRequest.resolve({ ok: true })
  await pendingSave
  assert.equal(preview.original.value, '已提交的编辑')
  assert.equal(preview.dirty.value, true)
  const staleSave = preview.save()
  const oldSave = saveRequest
  const eventCount = savedEvents.length
  previewProps.uuid = targetA.instanceUuid
  previewProps.daemonId = targetA.daemonId
  textRequests.at(-1).resolve({ text: '返回原实例的文本', truncated: false })
  await settle()
  oldSave.resolve({ ok: true })
  await staleSave
  assert.equal(preview.original.value, '返回原实例的文本')
  assert.equal(savedEvents.length, eventCount)
  for (const pending of textRequests) pending.resolve({ text: '迟到文本', truncated: false })
  await settle()
  console.log('通过：预览组件按实例重新载入、丢弃迟到文本和保存结果、保留提交后继续输入的修改')

  const statusRequests = []
  browserFetch = async (url, request) => {
    assert.equal(url, '/api/admin/mcsm/files/status')
    const pending = deferred()
    statusRequests.push({ ...pending, request })
    return pending.promise
  }
  const advancedProps = vue.reactive({ uuid: targetA.instanceUuid, daemonId: targetA.daemonId, canView: true, canEdit: true })
  const advanced = compilePage('app/components/ServerFileAdvanced.vue', advancedProps)
  advanced.archiveOpen.value = true
  advanced.downloadName.value = '/old-file.txt'
  advancedProps.uuid = targetB.instanceUuid
  advancedProps.daemonId = targetB.daemonId
  statusRequests.at(-1).resolve({ instanceFileTask: 2, downloadTasks: [] })
  await settle()
  for (const pending of statusRequests.slice(0, -1)) pending.resolve({ instanceFileTask: 9, downloadTasks: [] })
  await settle()
  assert.equal(advanced.status.value.instanceFileTask, 2)
  assert.equal(advanced.archiveOpen.value, false)
  assert.equal(advanced.downloadName.value, '')
  console.log('通过：高级文件任务切换重置、迟到状态不覆盖新实例')

  const files = [
    'server/utils/mcsm-instance.ts', 'server/utils/mcsm-server-config.ts',
    'server/utils/mcsm-files.ts', 'server/utils/mcsm-daemon.ts', 'server/utils/mcsm-upload.ts',
    'server/utils/mcsm-upload-target.ts', 'app/composables/useMcsmFileInstance.ts',
    'app/utils/directory-upload.ts',
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
