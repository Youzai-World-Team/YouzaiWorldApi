export type LocalUploadItem = { relativePath: string } & (
  | { kind: 'file'; file: File }
  | { kind: 'directory' }
)

export type UploadPlanItem = LocalUploadItem & { name: string; parentPath: string }

export interface UploadDirectoryHandle {
  kind: 'directory'
  name: string
  values: () => AsyncIterable<UploadDirectoryHandle | {
    kind: 'file'; name: string; getFile: () => Promise<File>
  }>
}

interface DroppedEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
  file?: (success: (file: File) => void, error: (error: DOMException) => void) => void
  createReader?: () => {
    readEntries: (success: (entries: DroppedEntry[]) => void, error: (error: DOMException) => void) => void
  }
}

const INVALID_NAME = /[\u0000-\u001f\u007f\\:*?"<>|]/
const MAX_NAME_LENGTH = 200

function assertReadingActive(isCurrent: () => boolean) {
  if (!isCurrent()) throw new Error('上传已取消')
}

export function filesToUploadItems(files: File[]): LocalUploadItem[] {
  return files.map(file => ({ kind: 'file', file, relativePath: file.webkitRelativePath || file.name }))
}

/** 先准备所有父目录，再上传文件；保留选择的根目录和显式读取到的空目录。 */
export function createUploadPlan(items: LocalUploadItem[]): UploadPlanItem[] {
  const directories = new Map<string, UploadPlanItem>()
  const files: UploadPlanItem[] = []
  for (const item of items) {
    const segments = item.relativePath.split('/')
    if (segments.some(name => !name.trim() || ['.', '..'].includes(name.trim())
      || name.length > MAX_NAME_LENGTH || INVALID_NAME.test(name))) {
      throw new Error(`文件路径含有不支持的名称：${item.relativePath}`)
    }
    for (let depth = 1; depth <= segments.length; depth++) {
      const relativePath = segments.slice(0, depth).join('/')
      const name = segments[depth - 1]!
      const parentPath = segments.slice(0, depth - 1).join('/')
      if (depth === segments.length && item.kind === 'file') {
        files.push({ ...item, name, parentPath })
      } else if (!directories.has(relativePath)) {
        directories.set(relativePath, { kind: 'directory', relativePath, name, parentPath })
      }
    }
  }
  if (files.some(item => directories.has(item.relativePath))) {
    throw new Error('所选内容中有文件和文件夹使用相同路径，请分批上传')
  }
  return [
    ...[...directories.values()].sort((a, b) => a.relativePath.split('/').length - b.relativePath.split('/').length),
    ...files,
  ]
}

/** 支持原生目录选择的浏览器可以完整读取空文件夹。 */
export async function readUploadDirectory(handle: UploadDirectoryHandle, isCurrent: () => boolean): Promise<LocalUploadItem[]> {
  const items: LocalUploadItem[] = []
  async function visit(directory: UploadDirectoryHandle, relativePath: string) {
    assertReadingActive(isCurrent)
    items.push({ kind: 'directory', relativePath })
    for await (const child of directory.values()) {
      assertReadingActive(isCurrent)
      const childPath = `${relativePath}/${child.name}`
      if (child.kind === 'directory') await visit(child, childPath)
      else {
        const file = await child.getFile()
        assertReadingActive(isCurrent)
        items.push({ kind: 'file', file, relativePath: childPath })
      }
    }
  }
  await visit(handle, handle.name)
  return items
}

/** 拖放数据只在当前事件中可读，因此必须在第一次 await 前取得所有入口。 */
export function readDroppedUploads(transfer: DataTransfer, isCurrent: () => boolean): LocalUploadItem[] | Promise<LocalUploadItem[]> {
  const roots = Array.from(transfer.items || []).filter(item => item.kind === 'file').map(item => ({
    entry: item.webkitGetAsEntry?.() as DroppedEntry | null | undefined,
    file: item.getAsFile(),
  }))
  const fallback = Array.from(transfer.files || [])
  if (!roots.length) return filesToUploadItems(fallback)
  if (roots.every(root => !root.entry?.isDirectory && root.file)) {
    return filesToUploadItems(roots.map(root => root.file!))
  }
  const items: LocalUploadItem[] = []
  async function visit(entry: DroppedEntry, parent = '') {
    assertReadingActive(isCurrent)
    const relativePath = parent ? `${parent}/${entry.name}` : entry.name
    if (entry.isDirectory && entry.createReader) {
      items.push({ kind: 'directory', relativePath })
      const reader = entry.createReader()
      // Chromium 每次最多返回一批条目，必须读到空批次才能结束。
      while (isCurrent()) {
        const children = await new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
        assertReadingActive(isCurrent)
        if (!children.length) break
        for (const child of children) await visit(child, relativePath)
      }
    } else if (entry.isFile && entry.file) {
      const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject))
      assertReadingActive(isCurrent)
      items.push({ kind: 'file', file, relativePath })
    } else throw new Error(`浏览器无法读取「${entry.name}」，请使用上传文件夹按钮`)
  }
  async function collect() {
    for (const root of roots) {
      if (root.entry) await visit(root.entry)
      else if (root.file) items.push(...filesToUploadItems([root.file]))
      else throw new Error('浏览器无法读取拖入的文件夹，请使用上传文件夹按钮')
    }
    return items
  }
  return collect()
}
