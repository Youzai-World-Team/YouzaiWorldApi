// 真实上传自检（有外部写入）：仅在明确授权后执行。
// node scripts/check-mcsm-upload-live.mjs --upload-test --cleanup
// 使用站点当前绑定，不启动服务器，不构建，不迁移数据库，不覆盖现有文件。
// 在实例根目录写入一个唯一命名的小文件，下载核对 SHA-256 后只删除这个测试文件。
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import vm from 'node:vm'

const root = fileURLToPath(new URL('../', import.meta.url))
assert.equal(path.resolve(process.cwd()), path.resolve(root), '请在 YouzaiWorldApi 根目录执行')
assert.ok(process.argv.includes('--upload-test') && process.argv.includes('--cleanup'),
  '真实上传需要同时指定 --upload-test --cleanup，且事先取得实例管理员授权')
const taskEnv = { ...(existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {}), ...process.env }
const configuredDataDir = taskEnv.YZWC_DATA_DIR?.trim() ? path.resolve(taskEnv.YZWC_DATA_DIR.trim()) : path.join(root, 'server/data')
const databasePath = path.join(configuredDataDir, 'database.db')
assert.ok(existsSync(databasePath), '没有找到站点数据库，不创建新的数据库')
const database = new DatabaseSync(databasePath, { readOnly: true })
const setting = key => database.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value
const config = () => ({
  baseUrl: setting('mcsm.base_url')?.trim() || taskEnv.YZWC_MCSM_BASE_URL?.trim() || '',
  apiKey: setting('mcsm.api_key')?.trim() || taskEnv.YZWC_MCSM_API_KEY?.trim() || '',
})
const target = () => {
  try { return JSON.parse(setting('mcsm.managed_instance') || 'null') } catch { return null }
}
const require = createRequire(import.meta.url)
const compilerFolder = readdirSync(path.join(root, 'node_modules/.pnpm')).find(name => name.startsWith('esbuild@'))
assert.ok(compilerFolder, '需要项目已安装的 esbuild')
const esbuild = require(path.join(root, 'node_modules/.pnpm', compilerFolder, 'node_modules/esbuild'))
const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'yzw-live-upload-check-'))
const modules = new Map()
const error = options => Object.assign(new Error(options.statusMessage), options)
const context = vm.createContext({
  console, Buffer, URL, URLSearchParams, Uint8Array, Blob, FormData, AbortController, AbortSignal,
  fetch: (url, options) => fetch(url, { ...options, redirect: 'error' }),
  createError: error, defineEventHandler: handler => handler,
  getQuery: event => event.query, getHeader: (event, name) => event.headers?.[name],
})
// 实际数据库只读；自检直接调用路由函数，网页登录、审计入库由常规回归单独验证。
const dbAdapter = {
  getMcsmConfig: config, getAdminMcsmConfig: config, getMcsmManagedInstance: target,
  requireFeaturePermission: () => ({ id: 'authorized-upload-self-check' }), recordAudit: () => {},
}
function load(file) {
  const absolute = path.resolve(root, file)
  if (modules.has(absolute)) return modules.get(absolute).exports
  const module = { exports: {} }
  modules.set(absolute, module)
  const localRequire = spec => {
    if (spec === 'h3') return { createError: error }
    if (spec.startsWith('node:')) return require(spec)
    const dependency = spec.startsWith('#shared/')
      ? path.join(root, 'shared', spec.slice(8) + '.ts')
      : spec.startsWith('.') ? path.resolve(path.dirname(absolute), spec) + '.ts' : null
    assert.ok(dependency && dependency.startsWith(path.resolve(root) + path.sep), '拒绝未预期的源码依赖')
    if (dependency === path.join(root, 'server/utils/db.ts')) return dbAdapter
    if (dependency === path.join(root, 'server/utils/data-dir.ts')) return { dataDir: dataDirectory }
    return load(path.relative(root, dependency))
  }
  const code = esbuild.transformSync(readFileSync(absolute, 'utf8'), { loader: 'ts', format: 'cjs', sourcefile: file }).code
  const wrapper = vm.runInContext('(function(require,module,exports){' + code + '\n})', context, { filename: file })
  wrapper(localRequire, module, module.exports)
  return module.exports
}

const unique = randomUUID()
const name = '.yzw-upload-check-' + unique + '-中文.txt'
const remotePath = '/' + name
const content = Buffer.from('悠哉世界文件上传链路自检\n测试标识：' + unique + '\n创建时间：' + new Date().toISOString() + '\n', 'utf8')
const expectedHash = createHash('sha256').update(content).digest('hex')
const initial = config()
let selected
let mcsm
let fileApi
let uploaded = false
let attempted = false
let removed = false
let cleanupMessage = ''
let failure
let stable

const sanitized = value => String(value || '未知错误').split(initial.apiKey || '\0').join('[已隐藏密钥]').slice(0, 700)
const findProbe = async () => {
  stable()
  const data = await mcsm.callPanel('/api/files/list', { query: {
    uuid: selected.instanceUuid, daemonId: selected.daemonId, target: '/', page: 0, page_size: 100, file_name: name,
  } })
  stable()
  assert.ok(Array.isArray(data?.items), '面板没有返回有效目录')
  return data.items.find(item => item.name === name)
}
const downloadHash = async () => {
  stable()
  const ticket = await fileApi.fileDownloadUrl(selected.instanceUuid, selected.daemonId, remotePath)
  const response = await fetch(ticket.url, { signal: AbortSignal.timeout(20_000), redirect: 'error' })
  assert.ok(response.ok && response.body, '测试文件下载失败，HTTP ' + response.status)
  const digest = createHash('sha256')
  const reader = response.body.getReader()
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      assert.ok(size <= content.length, '远端内容超过测试文件大小，停止读取')
      digest.update(part.value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  stable()
  assert.equal(size, content.length, '测试文件大小不符')
  return digest.digest('hex')
}
try {
  assert.ok(initial.baseUrl && initial.apiKey, '面板地址或 ApiKey 未配置')
  mcsm = load('server/utils/mcsm.ts')
  fileApi = load('server/utils/mcsm-files.ts')
  selected = target()
  assert.ok(selected?.instanceUuid && selected?.daemonId, '站点未绑定管理实例')
  stable = mcsm.createManagedInstanceGuard(selected.instanceUuid, selected.daemonId)
  await mcsm.assertManagedInstanceAllowed(selected.instanceUuid, selected.daemonId)
  assert.equal(await findProbe(), undefined, '唯一测试文件名意外存在，拒绝上传')
  console.log('预检通过：当前绑定归属有效，测试文件名未占用；即将上传 ' + content.length + ' 字节。')
  const route = load('server/api/admin/mcsm/files/upload-chunk.put.ts').default
  attempted = true
  const result = await route({
    query: { uuid: selected.instanceUuid, daemonId: selected.daemonId, path: '/', name, uploadId: unique,
      offset: '0', total: String(content.length), final: '1' },
    // 特意不带 Content-Length，验证该兼容修复。
    headers: {},
    node: { req: Readable.from([content]), res: Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false }) },
  })
  assert.equal(result.complete, true)
  assert.equal(result.uploaded, content.length)
  assert.equal(result.path, remotePath)
  const item = await findProbe()
  assert.ok(item && Number(item.type) === 1 && Number(item.size) === content.length, '真实服务器目录没有匹配文件')
  assert.equal(await downloadHash(), expectedHash, '真实服务器下载内容 SHA-256 不一致')
  uploaded = true
  console.log('真实上传与下载哈希校验通过，开始清理唯一测试文件。')
} catch (caught) {
  failure = caught
} finally {
  if (attempted) {
    try {
      const item = await findProbe()
      if (item) {
        // 即使之前的应答丢失，也必须先核实内容，绝不删掉内容不符的文件。
        assert.equal(await downloadHash(), expectedHash, '内容不符，保留文件等待人工确认')
        stable()
        await fileApi.deleteEntries(selected.instanceUuid, selected.daemonId, [remotePath])
        for (let attempt = 0; attempt < 20; attempt++) {
          if (!(await findProbe())) { removed = true; break }
          await delay(100)
        }
        assert.ok(removed, '未确认远端测试文件已删除')
      } else removed = true
    } catch (caught) { cleanupMessage = sanitized(caught.message) }
  }
  database.close()
  // 只移除本次 mkdtemp 创建的目录和受控 .part 文件，不做递归删除。
  assert.equal(path.dirname(path.resolve(dataDirectory)), path.resolve(os.tmpdir()))
  assert.ok(path.basename(dataDirectory).startsWith('yzw-live-upload-check-'))
  const stagingDirectory = path.join(dataDirectory, 'upload-staging')
  if (existsSync(stagingDirectory)) {
    for (const entry of readdirSync(stagingDirectory)) {
      assert.match(entry, /^[0-9a-f-]+\.part$/i)
      unlinkSync(path.join(stagingDirectory, entry))
    }
    rmdirSync(stagingDirectory)
  }
  rmdirSync(dataDirectory)
}
console.log(JSON.stringify({
  uploadVerified: uploaded, remoteTestFile: attempted ? remotePath : null, remoteTestFileRemoved: removed,
  localStagingRemoved: true, bytes: content.length, sha256: uploaded ? expectedHash : undefined,
  error: failure ? sanitized(failure.message) : undefined, cleanupError: cleanupMessage || undefined,
}, null, 2))
if (failure || cleanupMessage || !uploaded || !removed) process.exitCode = 1
