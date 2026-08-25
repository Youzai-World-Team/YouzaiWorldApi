import { createError } from 'h3'
import { callPanel } from './mcsm'
import { getAdminMcsmConfig } from './db'

/**
 * MCSManager 文件管理客户端。
 * <p>
 * 面板的文件接口官方文档覆盖得比较全，但几个结构容易记错，这里统一收口：
 * 复制与移动的 {@code targets} 是 {@code [[源, 目标]]} 这种成对数组；
 * 读写文本共用 {@code PUT /api/files/}（只带 target 是读，带 text 才是写）；
 * 压缩与解压共用 {@code POST /api/files/compress}（{@code type} 1 压 2 解）。
 * </p>
 * <p>
 * 下载和上传都是「先换一次性票据、再直连守护进程」两步式。浏览器直连守护进程会
 * 撞上混合内容与 CSP，所以这两条都由本服务端代理转发（见 {@code files/raw.get.ts}
 * 与 {@code files/upload.put.ts}）。
 * </p>
 */

const FILE_PAGE_SIZE = 200
// 在线编辑只针对文本配置：给个体积上限，别把几十 MB 的日志灌进浏览器。
export const TEXT_FILE_MAX_CHARS = 512 * 1024
// 内联预览的体积上限。下载不设限（流式转发），只有「在页面里显示」需要拦一下。
export const INLINE_PREVIEW_MAX_BYTES = 64 * 1024 * 1024
// 上传上限：模组包通常几十 MB，给到 256 MiB 足够，同时避免被当成无限上传通道。
export const UPLOAD_MAX_BYTES = 256 * 1024 * 1024

const TEXT_EXTENSIONS = new Set([
  'properties', 'json', 'json5', 'jsonc', 'mcmeta', 'yml', 'yaml', 'toml',
  'conf', 'cfg', 'ini', 'txt', 'md', 'log', 'sh', 'bat', 'cmd', 'ps1',
  'xml', 'csv', 'tsv', 'js', 'mjs', 'cjs', 'ts', 'css', 'snbt', 'nbt',
  'lang', 'env', 'gitignore', 'lock', 'sql',
])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac'])
const ARCHIVE_EXTENSIONS = new Set(['zip', 'jar', 'gz', 'tgz', 'tar', 'rar', '7z', 'bz2', 'xz'])
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'pptx'])
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown'])

/**
 * 可以内联下发的 MIME。
 * <p>
 * 刻意排除 svg / html / xml：它们能带脚本，而代理是同源下发的，内联等于把
 * 任意脚本放进后台源里执行。这类文件只能作为附件下载或按文本查看。
 * </p>
 */
const INLINE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
}

export type FileKind = 'directory' | 'image' | 'video' | 'audio' | 'archive' | 'document' | 'markdown' | 'text' | 'binary'

export interface FileEntry {
  name: string
  size: number
  time: string
  mode: number
  kind: FileKind
  /** 能用 Monaco 打开编辑。 */
  editable: boolean
  /** 能在页面里内联预览（图片 / 音视频 / 文档）。 */
  previewable: boolean
}

export function fileExtension(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index + 1).toLowerCase() : ''
}

export function classifyFile(name: string, directory: boolean): FileKind {
  if (directory) return 'directory'
  const ext = fileExtension(name)
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'binary'
}

/**
 * 规范化实例内的相对路径。
 * <p>
 * 面板的文件接口本身限定在实例目录内，这里再挡一层：拒掉 {@code ..}、{@code .}、
 * 盘符和控制字符，避免把越权路径原样透给面板。
 * </p>
 */
export function requireInstancePath(value: unknown, { allowRoot = true } = {}): string {
  const raw = String(value ?? '/').trim().replace(/\\/g, '/')
  const segments = raw.split('/').filter(Boolean)
  if (segments.includes('..') || segments.includes('.')) {
    throw createError({ statusCode: 400, statusMessage: '路径不能包含 . 或 .. 路径段' })
  }
  if (segments.length === 0) {
    if (!allowRoot) throw createError({ statusCode: 400, statusMessage: '需要指定文件路径' })
    return '/'
  }
  const normalized = `/${segments.join('/')}`
  if (normalized.length > 512 || /[\u0000-\u001f\u007f:*?"<>|]/.test(normalized)) {
    throw createError({ statusCode: 400, statusMessage: '路径含有不支持的字符或过长' })
  }
  return normalized
}

/** 单个文件名（不允许带路径分隔符），用于新建、重命名。 */
export function requireFileName(value: unknown): string {
  const name = String(value ?? '').trim()
  if (!name || name.length > 200) {
    throw createError({ statusCode: 400, statusMessage: '名称不能为空且不能超过 200 个字符' })
  }
  if (name === '.' || name === '..' || /[\u0000-\u001f\u007f/\\:*?"<>|]/.test(name)) {
    throw createError({ statusCode: 400, statusMessage: '名称含有不支持的字符' })
  }
  return name
}

export function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir.replace(/\/+$/, '')}/${name}`
}

function parentOf(path: string): string {
  const segments = path.split('/').filter(Boolean)
  segments.pop()
  return segments.length ? `/${segments.join('/')}` : '/'
}

function nameOf(path: string): string {
  return path.split('/').filter(Boolean).pop() || ''
}

/** 批量操作的入参：一组实例内路径，去重并限量。 */
function requirePathList(value: unknown, max = 100): string[] {
  const list = Array.isArray(value) ? value : []
  if (list.length === 0) {
    throw createError({ statusCode: 400, statusMessage: '请至少选择一个文件或目录' })
  }
  if (list.length > max) {
    throw createError({ statusCode: 400, statusMessage: `一次最多操作 ${max} 项` })
  }
  const paths = [...new Set(list.map((item) => requireInstancePath(item, { allowRoot: false })))]
  return paths
}

export async function listFiles(
  uuid: string,
  daemonId: string,
  targetValue: unknown,
  pageValue: unknown,
): Promise<{ path: string; page: number; pageSize: number; total: number; items: FileEntry[] }> {
  const target = requireInstancePath(targetValue)
  const rawPage = Math.trunc(Number(pageValue))
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 0

  const data = await callPanel<any>('/api/files/list', {
    query: { uuid, daemonId, target, page, page_size: FILE_PAGE_SIZE, file_name: '' },
  })
  const items = Array.isArray(data?.items) ? data.items : []
  return {
    path: target,
    page: Number(data?.page) || page,
    pageSize: Number(data?.pageSize) || FILE_PAGE_SIZE,
    total: Number(data?.total) || 0,
    items: items
      // 名字里带斜杠的条目不可能是同级项，出现就说明面板回了异常数据。
      .filter((item: any) => String(item?.name || '') && !String(item.name).includes('/'))
      .map((item: any) => {
        const name = String(item.name)
        const directory = Number(item?.type) === 0
        const kind = classifyFile(name, directory)
        return {
          name,
          size: Number(item?.size) || 0,
          time: String(item?.time || ''),
          mode: Number(item?.mode) || 0,
          kind,
          editable: kind === 'text' || kind === 'markdown',
          previewable: kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'document' || kind === 'markdown',
        }
      }),
  }
}

function requireTextFilePath(value: unknown): string {
  const path = requireInstancePath(value, { allowRoot: false })
  if (classifyFile(nameOf(path), false) !== 'text') {
    throw createError({ statusCode: 400, statusMessage: '只支持在线编辑文本文件' })
  }
  return path
}

/** 读取文本文件。面板的 PUT /api/files/ 只带 target 就是读，带 text 才是写。 */
export async function readTextFile(
  uuid: string,
  daemonId: string,
  targetValue: unknown,
): Promise<{ path: string; text: string; truncated: boolean }> {
  const path = requireTextFilePath(targetValue)
  const data = await callPanel<any>('/api/files/', {
    method: 'PUT',
    query: { uuid, daemonId },
    body: { target: path },
  })
  const text = typeof data === 'string' ? data : ''
  return {
    path,
    text: text.length > TEXT_FILE_MAX_CHARS ? text.slice(0, TEXT_FILE_MAX_CHARS) : text,
    truncated: text.length > TEXT_FILE_MAX_CHARS,
  }
}

export async function writeTextFile(
  uuid: string,
  daemonId: string,
  targetValue: unknown,
  textValue: unknown,
): Promise<void> {
  const path = requireTextFilePath(targetValue)
  const text = String(textValue ?? '')
  if (text.length > TEXT_FILE_MAX_CHARS) {
    throw createError({ statusCode: 400, statusMessage: '文件内容超出可编辑上限' })
  }
  await callPanel<any>('/api/files/', {
    method: 'PUT',
    query: { uuid, daemonId },
    body: { target: path, text },
  })
}

export async function makeDirectory(uuid: string, daemonId: string, dirValue: unknown, nameValue: unknown): Promise<string> {
  const dir = requireInstancePath(dirValue)
  const target = joinPath(dir, requireFileName(nameValue))
  await callPanel<any>('/api/files/mkdir', { method: 'POST', query: { uuid, daemonId }, body: { target } })
  return target
}

export async function createEmptyFile(uuid: string, daemonId: string, dirValue: unknown, nameValue: unknown): Promise<string> {
  const dir = requireInstancePath(dirValue)
  const target = joinPath(dir, requireFileName(nameValue))
  await callPanel<any>('/api/files/touch', { method: 'POST', query: { uuid, daemonId }, body: { target } })
  return target
}

/** 重命名：面板没有独立的 rename，用 move 在同目录内改名。 */
export async function renameEntry(
  uuid: string,
  daemonId: string,
  pathValue: unknown,
  newNameValue: unknown,
): Promise<string> {
  const path = requireInstancePath(pathValue, { allowRoot: false })
  const target = joinPath(parentOf(path), requireFileName(newNameValue))
  if (target === path) return path
  const result = await callPanel<any>('/api/files/move', {
    method: 'PUT',
    query: { uuid, daemonId },
    body: { targets: [[path, target]] },
  })

  // 检查重命名是否失败（可能被占用）
  if (result?.data) {
    if (typeof result.data === 'string' && (result.data.includes('占用') || result.data.includes('失败'))) {
      throw createError({
        statusCode: 500,
        statusMessage: `重命名失败：${result.data}。文件可能正被占用`
      })
    }
  }

  return target
}

/**
 * 复制或移动一批条目到目标目录。
 * <p>
 * 面板的 copy / move 都吃 {@code [[源, 目标]]} 成对数组，目标要写全路径，
 * 所以这里按「目标目录 + 原文件名」拼出来。把目录移进它自己的子目录会
 * 造成递归，这里先挡掉。
 * </p>
 */
export async function transferEntries(
  uuid: string,
  daemonId: string,
  pathsValue: unknown,
  toDirValue: unknown,
  mode: 'copy' | 'move',
): Promise<number> {
  const paths = requirePathList(pathsValue)
  const toDir = requireInstancePath(toDirValue)

  const targets = paths.map((path) => {
    if (toDir === path || toDir.startsWith(`${path}/`)) {
      throw createError({ statusCode: 400, statusMessage: `不能把「${nameOf(path)}」移动或复制到它自己的子目录里` })
    }
    const destination = joinPath(toDir, nameOf(path))
    if (destination === path) {
      throw createError({ statusCode: 400, statusMessage: `「${nameOf(path)}」的目标位置和当前位置相同` })
    }
    return [path, destination]
  })

  const endpoint = mode === 'copy' ? '/api/files/copy' : '/api/files/move'
  const method = mode === 'copy' ? 'POST' : 'PUT'
  const result = await callPanel<any>(endpoint, { method, query: { uuid, daemonId }, body: { targets } })

  // 检查是否有文件被占用或操作失败
  if (result?.data) {
    if (typeof result.data === 'string' && (result.data.includes('占用') || result.data.includes('失败'))) {
      throw createError({
        statusCode: 500,
        statusMessage: `${mode === 'copy' ? '复制' : '移动'}失败：${result.data}`
      })
    }
    if (Array.isArray(result.data)) {
      const failedItems = result.data.filter((item: any) => !item.success || item.error)
      if (failedItems.length > 0) {
        const failedPaths = failedItems.map((item: any) => item.path || item.target).filter(Boolean)
        if (failedPaths.length > 0) {
          throw createError({
            statusCode: 500,
            statusMessage: `部分文件${mode === 'copy' ? '复制' : '移动'}失败（可能被占用）：${failedPaths.slice(0, 3).join('、')}${failedPaths.length > 3 ? ` 等 ${failedPaths.length} 项` : ''}`
          })
        }
      }
    }
  }

  return targets.length
}

export async function deleteEntries(uuid: string, daemonId: string, pathsValue: unknown): Promise<string[]> {
  const paths = requirePathList(pathsValue)
  const result = await callPanel<any>('/api/files', {
    method: 'DELETE',
    query: { uuid, daemonId },
    body: { targets: paths }
  })

  // MCSManager 可能返回部分失败的信息
  // 检查返回的数据中是否有失败信息
  if (result?.data) {
    // 如果有失败的文件列表
    if (Array.isArray(result.data) && result.data.length > 0) {
      const failedFiles = result.data.filter((item: any) => !item.success || item.error)
      if (failedFiles.length > 0) {
        const failedPaths = failedFiles.map((item: any) => item.path || item.target).filter(Boolean)
        if (failedPaths.length > 0) {
          throw createError({
            statusCode: 500,
            statusMessage: `部分文件删除失败（可能被占用）：${failedPaths.slice(0, 3).join('、')}${failedPaths.length > 3 ? ` 等 ${failedPaths.length} 项` : ''}`
          })
        }
      }
    }
    // 如果返回的是错误信息字符串
    if (typeof result.data === 'string' && result.data.includes('占用')) {
      throw createError({
        statusCode: 500,
        statusMessage: `文件删除失败：${result.data}`
      })
    }
  }

  return paths
}

/** 把一批条目压缩成 zip。面板的压缩接口是同步返回的，大目录会占满整个请求。 */
export async function compressEntries(
  uuid: string,
  daemonId: string,
  pathsValue: unknown,
  dirValue: unknown,
  nameValue: unknown,
): Promise<string> {
  const paths = requirePathList(pathsValue, 50)
  const dir = requireInstancePath(dirValue)
  const name = requireFileName(nameValue)
  if (fileExtension(name) !== 'zip') {
    throw createError({ statusCode: 400, statusMessage: '压缩包名必须以 .zip 结尾' })
  }
  const source = joinPath(dir, name)
  const result = await callPanel<any>('/api/files/compress', {
    method: 'POST',
    query: { uuid, daemonId },
    body: { type: 1, code: 'utf-8', source, targets: paths },
  })

  // 检查压缩是否失败（通常因为文件被占用）
  if (result?.data) {
    if (typeof result.data === 'string' && (result.data.includes('占用') || result.data.includes('失败') || result.data.includes('error'))) {
      throw createError({
        statusCode: 500,
        statusMessage: `压缩失败：${result.data}。提示：运行中的服务器可能正在占用某些文件（如 mods 里的 jar）`
      })
    }
  }

  return source
}

/** 解压到指定目录，同名文件会被覆盖。 */
export async function extractArchive(
  uuid: string,
  daemonId: string,
  pathValue: unknown,
  toDirValue: unknown,
  createFolder?: boolean,
  folderName?: string,
): Promise<void> {
  const path = requireInstancePath(pathValue, { allowRoot: false })
  if (fileExtension(nameOf(path)) !== 'zip') {
    throw createError({ statusCode: 400, statusMessage: '只支持解压 zip 压缩包' })
  }
  let toDir = requireInstancePath(toDirValue)

  // 如果需要创建文件夹，先拼接目标路径
  if (createFolder && folderName?.trim()) {
    const cleanFolderName = folderName.trim().replace(/[\/\\]/g, '_') // 替换路径分隔符
    toDir = toDir === '/' ? `/${cleanFolderName}` : `${toDir}/${cleanFolderName}`
  }

  const result = await callPanel<any>('/api/files/compress', {
    method: 'POST',
    query: { uuid, daemonId },
    body: { type: 2, code: 'utf-8', source: path, targets: toDir },
  })

  // 检查解压是否失败
  if (result?.data) {
    if (typeof result.data === 'string' && (result.data.includes('占用') || result.data.includes('失败') || result.data.includes('error'))) {
      throw createError({
        statusCode: 500,
        statusMessage: `解压失败：${result.data}`
      })
    }
  }
}

// ===== 下载与上传：两步式票据 =====

const ADDR_RE = /^[A-Za-z0-9._-]+(?::\d{1,5})?$/

function daemonBase(addr: string, prefix: string): string {
  if (!ADDR_RE.test(addr)) {
    throw createError({ statusCode: 502, statusMessage: 'MCSM 面板返回的节点地址格式无法识别' })
  }
  // 节点用面板同一个协议：面板是 https 时节点也按 https 走。
  const scheme = new URL(getAdminMcsmConfig().baseUrl).protocol
  return `${scheme}//${addr}${prefix || ''}`
}

/** 换取某个文件的一次性下载地址（直连守护进程）。 */
export async function fileDownloadUrl(uuid: string, daemonId: string, pathValue: unknown): Promise<{ path: string; url: string }> {
  const path = requireInstancePath(pathValue, { allowRoot: false })
  const data = await callPanel<any>('/api/files/download', {
    method: 'POST',
    query: { uuid, daemonId, file_name: path },
  })
  const password = String(data?.password || '')
  const addr = String(data?.addr || '')
  if (!password || !addr) {
    throw createError({ statusCode: 502, statusMessage: 'MCSM 面板没有返回下载地址' })
  }
  return {
    path,
    url: `${daemonBase(addr, String(data?.prefix || ''))}/download/${encodeURIComponent(password)}/${encodeURIComponent(nameOf(path))}`,
  }
}

/** 换取上传地址（直连守护进程），由调用方把 multipart 转发过去。 */
export async function fileUploadUrl(uuid: string, daemonId: string, dirValue: unknown): Promise<{ dir: string; url: string }> {
  const dir = requireInstancePath(dirValue)
  const data = await callPanel<any>('/api/files/upload', {
    method: 'POST',
    query: { uuid, daemonId, upload_dir: dir },
  })
  const password = String(data?.password || '')
  const addr = String(data?.addr || '')
  if (!password || !addr) {
    throw createError({ statusCode: 502, statusMessage: 'MCSM 面板没有返回上传地址' })
  }
  return { dir, url: `${daemonBase(addr, String(data?.prefix || ''))}/upload/${encodeURIComponent(password)}` }
}

/** 内联预览时用的 Content-Type；不在白名单里的一律按附件下发。 */
export function inlineContentType(name: string): string | undefined {
  return INLINE_MIME[fileExtension(name)]
}
