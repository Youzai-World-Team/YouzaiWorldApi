<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createUploadPlan, filesToUploadItems, readDroppedUploads, readUploadDirectory,
  type LocalUploadItem, type UploadDirectoryHandle } from '../../utils/directory-upload'

useHead({ title: '服务器文件' })

interface FileEntry {
  name: string
  size: number
  time: string
  mode: number
  kind: string
  editable: boolean
  previewable: boolean
}

interface FileListResult {
  path: string
  items: FileEntry[]
  total: number
}

interface FileRequestContext {
  target: { uuid: string; daemonId: string }
  path: string
  generation: number
}

interface FileMenuState {
  id: number
  context: FileRequestContext
  entryName: string
  names: string[]
  selectionMode: boolean
  x: number
  y: number
  left: number
  top: number
  bounds: { left: number; top: number; width: number; height: number }
  trigger: HTMLElement | null
}

type FileMenuAction = 'open' | 'download' | 'copy' | 'move' | 'rename' | 'compress' | 'extract' | 'delete'
  | 'select' | 'select-all' | 'invert' | 'clear'

interface UploadDestination {
  name: string
  overwrite: boolean
}

interface UploadTargetCheck {
  name: string
  path: string
  existing: { name: string; type: number; size: number } | null
}

interface UploadDirectoryResult {
  ok: boolean
  name: string
  path: string
  created: boolean
}

interface UploadConflict {
  path: string
  existing: NonNullable<UploadTargetCheck['existing']>
}

type UploadConflictAction = 'replace' | 'rename'
interface UploadConflictChoice {
  action: UploadConflictAction
  applyToRemaining: boolean
}
interface UploadConflictPolicy {
  action: UploadConflictAction | null
}
interface UploadFileDecision extends UploadConflictPolicy {
  name: string
}

type UploadStatus = 'queued' | 'checking' | 'creating' | 'conflict' | 'uploading' | 'finalizing' | 'success' | 'error' | 'cancelled'
type UploadSource = 'picker' | 'directory' | 'drop'
interface UploadTask {
  id: number
  kind: 'file' | 'directory'
  originalName: string
  name: string
  size: number
  path: string
  status: UploadStatus
  percent: number
  message: string
}

const UPLOAD_STATUS_LABELS: Record<UploadStatus, string> = {
  queued: '等待上传',
  checking: '检查文件名',
  creating: '正在创建文件夹',
  conflict: '等待重名确认',
  uploading: '正在上传',
  finalizing: '正在写入服务器',
  success: '上传完成',
  error: '上传失败',
  cancelled: '已取消',
}
const UPLOAD_STATUS_ICONS: Record<UploadStatus, string> = {
  queued: 'schedule',
  checking: 'manage_search',
  creating: 'create_new_folder',
  conflict: 'help_outline',
  uploading: 'upload_file',
  finalizing: 'sync',
  success: 'check_circle',
  error: 'error_outline',
  cancelled: 'block',
}

const KIND_ICONS: Record<string, string> = {
  directory: 'folder',
  image: 'image',
  video: 'movie',
  audio: 'audio_file',
  archive: 'folder_zip',
  document: 'description',
  markdown: 'article',
  text: 'description',
  binary: 'draft',
}
const ARCHIVE_SUFFIXES = ['.tar.bz2', '.tar.xz', '.tar.gz', '.7z', '.zip', '.rar', '.iso', '.cab', '.tar', '.gz', '.bz2']
const FILE_MENU_EDGE = 8

type SortField = 'name' | 'size' | 'time'

const { showToast } = useToast()
const access = useAdminAccess()
const canEditPage = computed(() => access.levelForKey('server-files') === 'edit')
const canModifyFiles = computed(() => canEditPage.value && access.featureLevelForKey('server-files-edit') === 'edit')
const canUploadFiles = computed(() => canEditPage.value && access.featureLevelForKey('server-files-upload') === 'edit')
const canDeleteFiles = computed(() => canEditPage.value && access.featureLevelForKey('server-files-delete') === 'edit')
const canConfigureMcsm = computed(() => access.levelForKey('settings') === 'edit'
  && access.featureLevelForKey('settings-mcsm') === 'edit')
const { apply: applyDialogAnimation } = useDialogAnimation()

const { loading, refreshing, configured, instanceConfigured, instance, instanceKey, loadError, refreshInstance } = useMcsmFileInstance()

const path = ref('/')
const items = ref<FileEntry[]>([])
const total = ref(0)
const listLoading = ref(false)

const keyword = ref('')
const fileView = ref<'list' | 'grid'>('list')
const sortField = ref<SortField>('name')
const sortAsc = ref(true)
// 选中项按名字记，切目录时清空——不同目录同名文件不该串在一起。
const selectedNames = ref<string[]>([])

const previewOpen = ref(false)
const previewFullscreen = ref(false)
const previewTarget = ref<FileEntry | null>(null)
const previewDialog = ref<HTMLElement | null>(null)
const previewRef = ref<{ relayout: () => void; save: () => Promise<void>; dirty: boolean } | null>(null)

const createOpen = ref(false)
const createKind = ref<'directory' | 'file'>('directory')
const createName = ref('')
const createBusy = ref(false)
const createDialog = ref<HTMLElement | null>(null)

const renameTarget = ref<FileEntry | null>(null)
const renameName = ref('')
const renameBusy = ref(false)
const renameDialog = ref<HTMLElement | null>(null)

const transferMode = ref<'copy' | 'move' | null>(null)
const transferDir = ref('/')
const transferBusy = ref(false)
const transferDialog = ref<HTMLElement | null>(null)
const transferBrowsePath = ref('/')
const transferBrowseList = ref<FileEntry[]>([])
const transferBrowseLoading = ref(false)

const compressOpen = ref(false)
const compressName = ref('')
const compressBusy = ref(false)
const compressDialog = ref<HTMLElement | null>(null)

const deleteOpen = ref(false)
const deleteBusy = ref(false)
const extractTarget = ref<FileEntry | null>(null)
const extractBusy = ref(false)
const extractMode = ref<'current' | 'folder'>('folder')
const extractFolderName = ref('')
const extractDialog = ref<HTMLElement | null>(null)

const uploading = ref(false)
const uploadPreparing = ref(false)
const uploadMenuOpen = ref(false)
const uploadQueueOpen = ref(false)
// 仅对本次进入页面有效，刷新目录、结束批次或切换实例都不重置用户的收起选择。
const uploadQueueAutoOpened = ref(false)
const uploadQueueAutoOpenDismissed = ref(false)
// 只保留本页的任务元数据，不持有已完成文件的二进制内容。
const uploadTasks = ref<UploadTask[]>([])
const uploadList = ref<HTMLElement | null>(null)
const uploadConflict = ref<UploadConflict | null>(null)
const uploadConflictDialog = ref<HTMLElement | null>(null)
const uploadApplyToRemaining = ref(false)
const dragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const directoryInput = ref<HTMLInputElement | null>(null)
const fileMenu = ref<FileMenuState | null>(null)
const fileMenuElement = ref<HTMLElement | null>(null)
const filesTableWrap = ref<HTMLElement | null>(null)
const fullscreenBody = ref<HTMLElement | null>(null)
const transferBrowserList = ref<HTMLElement | null>(null)
let uploadRequest: XMLHttpRequest | null = null
let uploadCheckRequest: AbortController | null = null
let uploadConflictResolver: ((choice: UploadConflictChoice | null) => void) | null = null
const UPLOAD_MAX_BYTES = 256 * 1024 * 1024
let instanceGeneration = 0
let listRequestId = 0
let transferRequestId = 0
let uploadRun = 0
let uploadTaskId = 0
let fileMenuId = 0
let disposed = false

const uploadSummary = computed(() => {
  const tasks = uploadTasks.value
  const success = tasks.filter((task) => task.status === 'success').length
  const failed = tasks.filter((task) => task.status === 'error').length
  const cancelled = tasks.filter((task) => task.status === 'cancelled').length
  return { total: tasks.length, success, failed, cancelled, pending: tasks.length - success - failed - cancelled }
})
const finishedUploadCount = computed(() => uploadSummary.value.total - uploadSummary.value.pending)
const orderedUploadTasks = computed(() => [
  // 进行中及等待任务始终优先展示，历史记录按最近结束的排在前面。
  ...uploadTasks.value.filter(isUploadPending),
  ...uploadTasks.value.filter((task) => !isUploadPending(task)).reverse(),
])

const crumbs = computed(() => {
  const parts = path.value.split('/').filter(Boolean)
  return parts.map((name, index) => ({ name, path: `/${parts.slice(0, index + 1).join('/')}` }))
})
const parentPath = computed(() => {
  const parts = path.value.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `/${parts.join('/')}` : '/'
})

const visibleItems = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  const list = items.value.filter((item) => !text || item.name.toLowerCase().includes(text))
  const direction = sortAsc.value ? 1 : -1
  return [...list].sort((a, b) => {
    // 目录始终排在文件前面，排序只在同类之间比较。
    if ((a.kind === 'directory') !== (b.kind === 'directory')) return a.kind === 'directory' ? -1 : 1
    if (sortField.value === 'size') return (a.size - b.size) * direction
    if (sortField.value === 'time') return (Date.parse(a.time) - Date.parse(b.time) || 0) * direction
    return a.name.localeCompare(b.name, 'zh-Hans-CN') * direction
  })
})

const selectedEntries = computed(() => items.value.filter((item) => selectedNames.value.includes(item.name)))
const allVisibleSelected = computed(() =>
  visibleItems.value.length > 0 && visibleItems.value.every((item) => selectedNames.value.includes(item.name)))
const fileMenuEntries = computed(() => {
  const names = new Set(fileMenu.value?.names)
  return items.value.filter((item) => names.has(item.name))
})
const fileMenuSingle = computed(() => fileMenuEntries.value.length === 1 ? fileMenuEntries.value[0]! : null)

function fullPath(name: string) {
  return path.value === '/' ? `/${name}` : `${path.value}/${name}`
}

function isExtractable(entry: FileEntry) {
  const lower = entry.name.toLowerCase()
  return entry.kind === 'archive' && ARCHIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

function formatBytes(value: number) {
  if (!value) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`
}

function formatTime(value: string) {
  if (!value) return '—'
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString('zh-CN')
}

function errorMessage(error: any, fallback: string) {
  return error?.data?.statusMessage || error?.statusMessage || fallback
}

function goToSettings() {
  void navigateTo('/settings#mcsm')
}

function requestBase() {
  return { uuid: instance.value?.instanceUuid || '', daemonId: instance.value?.daemonId || '' }
}

function captureFileContext(): FileRequestContext | null {
  if (!instance.value || disposed) return null
  return { target: requestBase(), path: path.value, generation: instanceGeneration }
}

function isFileContextCurrent(context: FileRequestContext) {
  return !disposed && context.generation === instanceGeneration
}

async function refreshPage() {
  const previousKey = instanceKey.value
  await refreshInstance()
  // 新绑定由监听器读取根目录，同一个实例则保留当前目录。
  if (previousKey && previousKey === instanceKey.value) await loadList()
}

async function loadList(next = path.value) {
  const context = captureFileContext()
  if (!context) return
  closeFileMenu()
  const requestId = ++listRequestId
  const isCurrent = () => isFileContextCurrent(context) && requestId === listRequestId
  listLoading.value = true
  try {
    const result = await $fetch<{ path: string; total: number; items: FileEntry[] }>('/api/admin/mcsm/files', {
      query: { ...context.target, path: next },
    })
    if (!isCurrent()) return
    if (result.path !== path.value) selectedNames.value = []
    path.value = result.path
    items.value = result.items
    total.value = result.total
    // 目录内容变了以后，选中项里已经不存在的要剔掉。
    selectedNames.value = selectedNames.value.filter((name) => result.items.some((item) => item.name === name))
  } catch (error: any) {
    if (isCurrent()) showToast(errorMessage(error, '目录加载失败'), 'error')
  } finally {
    if (isCurrent()) listLoading.value = false
  }
}

function openEntry(entry: FileEntry) {
  if (entry.kind === 'directory') {
    void loadList(fullPath(entry.name))
    return
  }
  openPreview(entry)
}

function toggleSelect(name: string) {
  selectedNames.value = selectedNames.value.includes(name)
    ? selectedNames.value.filter((item) => item !== name)
    : [...selectedNames.value, name]
}

function toggleAll() {
  selectedNames.value = allVisibleSelected.value ? [] : visibleItems.value.map((item) => item.name)
}

function selectAllVisible() {
  selectedNames.value = visibleItems.value.map((item) => item.name)
}

function invertVisibleSelection() {
  const selected = new Set(selectedNames.value)
  selectedNames.value = visibleItems.value.filter((item) => !selected.has(item.name)).map((item) => item.name)
}

function toggleFileView() {
  fileView.value = fileView.value === 'list' ? 'grid' : 'list'
}

function setSort(field: SortField) {
  if (sortField.value === field) sortAsc.value = !sortAsc.value
  else {
    sortField.value = field
    sortAsc.value = true
  }
}

// ===== 文件菜单：列表、大图标和触屏的更多按钮共用 =====

function closeFileMenu(id = fileMenu.value?.id) {
  // 旧菜单的关闭动画可能晚于下一次右键，不能把新菜单一起关闭。
  if (fileMenu.value?.id === id) fileMenu.value = null
}

function onFileMenuClosed(event: Event) {
  closeFileMenu(Number((event.target as HTMLElement).dataset.menuId))
}

function getFileMenuBounds() {
  const viewport = window.visualViewport
  const viewportLeft = viewport?.offsetLeft ?? 0
  const viewportTop = viewport?.offsetTop ?? 0
  const appBarBottom = document.querySelector('.app-bar')?.getBoundingClientRect().bottom ?? 0
  const left = viewportLeft + FILE_MENU_EDGE
  const top = Math.max(viewportTop, appBarBottom) + FILE_MENU_EDGE
  const right = Math.min(document.documentElement.clientWidth,
    viewportLeft + (viewport?.width ?? window.innerWidth)) - FILE_MENU_EDGE
  const bottom = Math.min(document.documentElement.clientHeight,
    viewportTop + (viewport?.height ?? window.innerHeight)) - FILE_MENU_EDGE
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

async function positionFileMenu(event: Event) {
  const menu = fileMenu.value
  const element = event.target as HTMLElement & { reposition: () => void }
  if (!menu || Number(element.dataset.menuId) !== menu.id) return

  const { width, height } = element.getBoundingClientRect()
  const { bounds } = menu
  const left = Math.max(bounds.left, Math.min(menu.x, bounds.left + bounds.width - Math.ceil(width)))
  const top = Math.max(bounds.top, Math.min(menu.y, bounds.top + bounds.height - Math.ceil(height)))
  if (menu.left === left && menu.top === top) return
  menu.left = left
  menu.top = top
  await nextTick()
  if (fileMenu.value?.id === menu.id) element.reposition()
}

function openFileMenu(event: MouseEvent | KeyboardEvent, entry: FileEntry) {
  const context = captureFileContext()
  if (!context || listLoading.value || !visibleItems.value.some((item) => item.name === entry.name)) return
  uploadMenuOpen.value = false
  event.preventDefault()

  const menuBounds = getFileMenuBounds()
  if (!menuBounds.width || !menuBounds.height) {
    closeFileMenu()
    return
  }
  const selectionMode = selectedEntries.value.length > 0
  // 右键已选项保留整组；右键未选项只操作它，避免误改其他选中的文件。
  if (selectionMode && !selectedNames.value.includes(entry.name)) selectedNames.value = [entry.name]
  const names = selectionMode ? selectedEntries.value.map((item) => item.name) : [entry.name]
  const element = event.currentTarget as HTMLElement | null
  const trigger = element?.matches('button, md-icon-button')
    ? element : element?.querySelector<HTMLElement>('.file-entry-open') || null
  const bounds = (trigger || element)?.getBoundingClientRect()
  const atPointer = event.type === 'contextmenu' && 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0)
  const x = atPointer ? event.clientX : bounds?.left ?? FILE_MENU_EDGE
  const y = atPointer ? event.clientY : bounds?.bottom ?? FILE_MENU_EDGE
  trigger?.focus({ preventScroll: true })
  fileMenu.value = {
    id: ++fileMenuId, context, entryName: entry.name, names, selectionMode, trigger,
    x: Math.max(menuBounds.left, Math.min(x, menuBounds.left + menuBounds.width)),
    y: Math.max(menuBounds.top, Math.min(y, menuBounds.top + menuBounds.height)),
    // 先在可用区左上角测量完整菜单，避免组件按点击点单侧的剩余空间压缩高度。
    left: menuBounds.left, top: menuBounds.top, bounds: menuBounds,
  }
}

function onFileMenuKeydown(event: KeyboardEvent, entry: FileEntry) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
  event.stopPropagation()
  event.preventDefault()
  openFileMenu(event, entry)
}

function onFileMenuScroll(event: Event) {
  // 仅在可用屏幕确实放不下完整菜单时保留内部滚动；页面滚动仍收起菜单。
  const element = fileMenuElement.value
  if (fileMenu.value && (!element || !event.composedPath().includes(element))) closeFileMenu()
}

function closeFileMenuOnResize() {
  closeFileMenu()
}

function runFileMenuAction(action: FileMenuAction) {
  const menu = fileMenu.value
  if (!menu) return
  const entries = fileMenuEntries.value
  closeFileMenu(menu.id)
  if (!isFileContextCurrent(menu.context) || menu.context.path !== path.value
    || listLoading.value || entries.length !== menu.names.length) return
  if (['copy', 'move', 'rename', 'compress', 'extract'].includes(action) && !canModifyFiles.value) return
  if (action === 'delete' && !canDeleteFiles.value) return

  menu.trigger?.focus({ preventScroll: true })
  const single = entries.length === 1 ? entries[0]! : null
  switch (action) {
    case 'select': selectedNames.value = [...menu.names]; break
    case 'select-all': selectAllVisible(); break
    case 'invert': invertVisibleSelection(); break
    case 'clear': selectedNames.value = []; break
    case 'open': if (single) openEntry(single); break
    case 'rename': if (single) openRename(single); break
    case 'extract': if (single && isExtractable(single)) openExtract(single); break
    case 'download':
      if (single) downloadEntry(single)
      else {
        selectedNames.value = [...menu.names]
        downloadSelected()
      }
      break
    case 'copy':
    case 'move':
      selectedNames.value = [...menu.names]
      openTransfer(action)
      break
    case 'compress':
      selectedNames.value = [...menu.names]
      openCompress()
      break
    case 'delete':
      selectedNames.value = [...menu.names]
      deleteOpen.value = true
      break
  }
}

watch([path, items, keyword, sortField, sortAsc, fileView, selectedNames], () => closeFileMenu(), { flush: 'sync' })

// ===== 预览 =====

function openPreview(entry: FileEntry) {
  previewTarget.value = entry
  previewFullscreen.value = false
  previewOpen.value = true
  applyDialogAnimation(previewDialog.value)
}

function closePreview() {
  previewOpen.value = false
  previewFullscreen.value = false
}

/** 触发预览组件里的保存；给弹窗底部按钮和 Ctrl+S 共用。 */
function savePreviewFile() {
  void previewRef.value?.save?.()
}

/**
 * Ctrl+S / Cmd+S 保存正在编辑的文件。
 * <p>
 * 只在预览弹窗或全屏预览打开、且这个文件确实可编辑时接管快捷键，
 * 其余情况让浏览器保持原本的「保存网页」行为。
 * </p>
 */
function onSaveShortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
  if (!previewOpen.value && !previewFullscreen.value) return
  if (!previewTarget.value?.editable || !canModifyFiles.value) return
  event.preventDefault()
  savePreviewFile()
}

/** 网页全屏：不用 Fullscreen API，改成铺满视口的浮层，行为在各浏览器里一致。 */
function enterFullscreen() {
  previewOpen.value = false
  previewFullscreen.value = true
  void nextTick(() => previewRef.value?.relayout())
}

function exitFullscreen() {
  previewFullscreen.value = false
  previewOpen.value = true
  void nextTick(() => previewRef.value?.relayout())
}

function previewPageUrl(entry: FileEntry) {
  const params = new URLSearchParams({
    ...requestBase(),
    path: fullPath(entry.name),
    kind: entry.kind,
    size: String(entry.size),
  })
  return `/server-files/preview?${params.toString()}`
}

function downloadUrl(entry: FileEntry) {
  const params = new URLSearchParams({ ...requestBase(), path: fullPath(entry.name), download: '1' })
  return `/api/admin/mcsm/files/raw?${params.toString()}`
}

function onFullscreenKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && previewFullscreen.value) exitFullscreen()
}

// ===== 增删改 =====

function openCreate(kind: 'directory' | 'file') {
  if (!canModifyFiles.value) return
  createKind.value = kind
  createName.value = ''
  createOpen.value = true
  applyDialogAnimation(createDialog.value)
}

async function submitCreate() {
  const context = captureFileContext()
  if (!context || !canModifyFiles.value || createBusy.value || !createName.value.trim()) return
  createBusy.value = true
  try {
    await $fetch('/api/admin/mcsm/files/create', {
      method: 'POST',
      body: { ...requestBase(), path: path.value, name: createName.value.trim(), kind: createKind.value },
    })
    if (!isFileContextCurrent(context)) return
    showToast(createKind.value === 'directory' ? '目录已创建' : '文件已创建')
    createOpen.value = false
    await loadList()
  } catch (error: any) {
    if (isFileContextCurrent(context)) showToast(errorMessage(error, '创建失败'), 'error')
  } finally {
    if (isFileContextCurrent(context)) createBusy.value = false
  }
}

function openRename(entry: FileEntry) {
  if (!canModifyFiles.value) return
  renameTarget.value = entry
  renameName.value = entry.name
  applyDialogAnimation(renameDialog.value)
}

async function submitRename() {
  const target = renameTarget.value
  const context = captureFileContext()
  if (!context || !target || !canModifyFiles.value || renameBusy.value) return
  const name = renameName.value.trim()
  if (!name || name === target.name) {
    renameTarget.value = null
    return
  }
  renameBusy.value = true
  try {
    await $fetch('/api/admin/mcsm/files/rename', {
      method: 'POST',
      body: { ...requestBase(), path: fullPath(target.name), name },
    })
    if (!isFileContextCurrent(context)) return
    showToast('已重命名')
    renameTarget.value = null
    await loadList()
  } catch (error: any) {
    if (isFileContextCurrent(context)) showToast(errorMessage(error, '重命名失败'), 'error')
  } finally {
    if (isFileContextCurrent(context)) renameBusy.value = false
  }
}

function openTransfer(mode: 'copy' | 'move') {
  if (!canModifyFiles.value || !selectedEntries.value.length) return
  transferMode.value = mode
  transferDir.value = path.value
  transferBrowsePath.value = '/'
  void loadTransferBrowseList('/')
  applyDialogAnimation(transferDialog.value)
}

async function loadTransferBrowseList(targetPath: string = transferBrowsePath.value) {
  const context = captureFileContext()
  if (!context) return
  const requestId = ++transferRequestId
  const isCurrent = () => isFileContextCurrent(context) && requestId === transferRequestId
  transferBrowseLoading.value = true
  try {
    const result = await $fetch<FileListResult>('/api/admin/mcsm/files', {
      query: { ...context.target, path: targetPath },
    })
    if (!isCurrent()) return
    transferBrowsePath.value = targetPath
    // 只显示目录
    transferBrowseList.value = result.items.filter((item) => item.kind === 'directory')
  } catch (error: any) {
    if (isCurrent()) showToast(errorMessage(error, '加载目录失败'), 'error')
  } finally {
    if (isCurrent()) transferBrowseLoading.value = false
  }
}

function selectTransferDir(dirName: string) {
  const selected = transferBrowsePath.value === '/'
    ? `/${dirName}`
    : `${transferBrowsePath.value}/${dirName}`
  transferDir.value = selected
}

async function submitTransfer() {
  const mode = transferMode.value
  const context = captureFileContext()
  if (!context || !mode || !canModifyFiles.value || transferBusy.value) return
  transferBusy.value = true
  try {
    const result = await $fetch<{ count: number }>('/api/admin/mcsm/files/transfer', {
      method: 'POST',
      body: {
        ...requestBase(),
        paths: selectedEntries.value.map((entry) => fullPath(entry.name)),
        toDir: transferDir.value.trim() || '/',
        mode,
      },
    })
    if (!isFileContextCurrent(context)) return
    showToast(`${mode === 'copy' ? '已复制' : '已移动'} ${result.count} 项`)
    transferMode.value = null
    selectedNames.value = []
    await loadList()
  } catch (error: any) {
    if (isFileContextCurrent(context)) showToast(errorMessage(error, mode === 'copy' ? '复制失败' : '移动失败'), 'error')
  } finally {
    if (isFileContextCurrent(context)) transferBusy.value = false
  }
}

function openCompress() {
  if (!canModifyFiles.value || !selectedEntries.value.length) return
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
  compressName.value = `archive-${stamp}.zip`
  compressOpen.value = true
  applyDialogAnimation(compressDialog.value)
}

function downloadSelected() {
  if (!selectedEntries.value.length) return

  // 单文件直接下载
  if (selectedEntries.value.length === 1) {
    downloadEntry(selectedEntries.value[0]!)
    return
  }

  // 多文件：提示先压缩再下载
  showToast('多文件下载：请先使用"压缩"功能打包，然后下载压缩包', 'info')
}

function downloadEntry(entry: FileEntry) {
  if (entry.kind === 'directory') {
    showToast('请先将目录压缩打包，再下载压缩包', 'info')
    return
  }
  const link = document.createElement('a')
  link.href = downloadUrl(entry)
  link.download = entry.name
  link.click()
}

function copySingle(entry: FileEntry) {
  if (!canModifyFiles.value) return
  selectedNames.value = [entry.name]
  openTransfer('copy')
}

function moveSingle(entry: FileEntry) {
  if (!canModifyFiles.value) return
  selectedNames.value = [entry.name]
  openTransfer('move')
}

function deleteSingle(entry: FileEntry) {
  if (!canDeleteFiles.value) return
  selectedNames.value = [entry.name]
  deleteOpen.value = true
}

async function submitCompress() {
  const context = captureFileContext()
  if (!context || !canModifyFiles.value || compressBusy.value || !compressName.value.trim()) return
  compressBusy.value = true
  try {
    await $fetch('/api/admin/mcsm/files/archive', {
      method: 'POST',
      body: {
        ...requestBase(),
        mode: 'compress',
        paths: selectedEntries.value.map((entry) => fullPath(entry.name)),
        dir: path.value,
        name: compressName.value.trim(),
      },
    })
    if (!isFileContextCurrent(context)) return
    showToast('压缩完成')
    compressOpen.value = false
    selectedNames.value = []
    await loadList()
  } catch (error: any) {
    if (isFileContextCurrent(context)) showToast(errorMessage(error, '压缩失败，运行中的服务器会占用部分文件'), 'error')
  } finally {
    if (isFileContextCurrent(context)) compressBusy.value = false
  }
}

async function confirmExtract() {
  const target = extractTarget.value
  const context = captureFileContext()
  if (!context || !target || !canModifyFiles.value || extractBusy.value) return

  // 如果选择创建文件夹模式，需要检查文件夹名
  if (extractMode.value === 'folder' && !extractFolderName.value.trim()) {
    showToast('请输入文件夹名称', 'error')
    return
  }

  extractBusy.value = true
  try {
    await $fetch('/api/admin/mcsm/files/archive', {
      method: 'POST',
      body: {
        ...requestBase(),
        mode: 'extract',
        path: fullPath(target.name),
        dir: path.value,
        createFolder: extractMode.value === 'folder',
        folderName: extractMode.value === 'folder' ? extractFolderName.value.trim() : undefined,
      },
    })
    if (!isFileContextCurrent(context)) return
    showToast('解压完成')
    extractTarget.value = null
    await loadList()
  } catch (error: any) {
    if (isFileContextCurrent(context)) showToast(errorMessage(error, '解压失败'), 'error')
  } finally {
    if (isFileContextCurrent(context)) extractBusy.value = false
  }
}

function openExtract(entry: FileEntry) {
  if (!canModifyFiles.value) return
  extractTarget.value = entry
  extractMode.value = 'folder'
  // 默认文件夹名为去掉 .zip 扩展名
  const baseName = entry.name.replace(/\.(?:tar\.bz2|tar\.xz|tar\.gz|7z|zip|rar|iso|cab|tar|gz|bz2)$/i, '')
  extractFolderName.value = baseName
  applyDialogAnimation(extractDialog.value)
}

async function confirmDelete() {
  const context = captureFileContext()
  if (!context || !canDeleteFiles.value || deleteBusy.value || !selectedEntries.value.length) return
  deleteBusy.value = true
  try {
    const result = await $fetch<{ count: number }>('/api/admin/mcsm/files/delete', {
      method: 'POST',
      body: { ...requestBase(), paths: selectedEntries.value.map((entry) => fullPath(entry.name)) },
    })
    if (!isFileContextCurrent(context)) return
    showToast(`已删除 ${result.count} 项`)
    deleteOpen.value = false
    selectedNames.value = []
    await loadList()
  } catch (error: any) {
    if (isFileContextCurrent(context)) showToast(errorMessage(error, '删除失败'), 'error')
  } finally {
    if (isFileContextCurrent(context)) deleteBusy.value = false
  }
}

// ===== 上传 =====

function toggleUploadQueue() {
  if (uploadQueueOpen.value && uploadQueueAutoOpened.value) uploadQueueAutoOpenDismissed.value = true
  uploadQueueOpen.value = !uploadQueueOpen.value
}

function toggleUploadMenu() {
  if (!canUploadFiles.value || uploading.value) return
  closeFileMenu()
  uploadMenuOpen.value = !uploadMenuOpen.value
}

function pickFiles() {
  uploadMenuOpen.value = false
  if (!canUploadFiles.value || uploading.value) return
  fileInput.value?.click()
}

function pickDirectory() {
  uploadMenuOpen.value = false
  if (!canUploadFiles.value || uploading.value) return
  const picker = (window as Window & { showDirectoryPicker?: () => Promise<UploadDirectoryHandle> }).showDirectoryPicker
  if (!picker) {
    directoryInput.value?.click()
    return
  }
  return uploadBatch(async isCurrent => readUploadDirectory(await picker.call(window), isCurrent), 'directory')
}

function onDirectoryPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  return uploadFiles(files, 'directory')
}

function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  void uploadFiles(files)
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  if (!canUploadFiles.value) return
  if (uploading.value) {
    showToast('请等待当前上传结束后再添加文件', 'error')
    return
  }
  if (event.dataTransfer) return uploadBatch(isCurrent => readDroppedUploads(event.dataTransfer!, isCurrent), 'drop')
}

function suggestUploadName(name: string) {
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot) : ''
  const stem = name.slice(0, name.length - extension.length)
  // 已有编号时直接递增，避免出现「文件 (1) (1).txt」。
  const numbered = /^(.*) \((\d+)\)$/.exec(stem)
  const suffix = ` (${numbered ? BigInt(numbered[2]!) + 1n : 1n})`
  const maxStemLength = 200 - extension.length - suffix.length
  if (maxStemLength < 1) throw new Error('自动改名后的名称过长，请先缩短本地文件名')
  // 不截断扩展名；截短过长文件名时也不留下半个 Unicode 字符。
  const base = (numbered ? numbered[1]! : stem).slice(0, maxStemLength).replace(/[\uD800-\uDBFF]$/, '')
  if (!base) throw new Error('自动改名后的名称过长，请先缩短本地文件名')
  return `${base}${suffix}${extension}`
}

function resolveUploadConflict(choice: UploadConflictChoice | null) {
  const resolve = uploadConflictResolver
  uploadConflictResolver = null
  uploadConflict.value = null
  uploadApplyToRemaining.value = false
  resolve?.(choice)
}

function confirmUploadReplacement() {
  const conflict = uploadConflict.value
  if (!conflict || conflict.existing.type !== 1 || !canUploadFiles.value) return
  resolveUploadConflict({ action: 'replace', applyToRemaining: uploadApplyToRemaining.value })
}

function confirmUploadRename() {
  const conflict = uploadConflict.value
  if (!conflict || !canUploadFiles.value) return
  resolveUploadConflict({ action: 'rename', applyToRemaining: uploadApplyToRemaining.value })
}

async function chooseUploadDestination(decision: UploadFileDecision, policy: UploadConflictPolicy,
  context: FileRequestContext, isCurrent: () => boolean, task: UploadTask): Promise<UploadDestination | null> {
  while (isCurrent()) {
    task.name = decision.name
    task.status = 'checking'
    task.percent = 0
    const controller = new AbortController()
    uploadCheckRequest = controller
    let checked: UploadTargetCheck
    try {
      checked = await $fetch<UploadTargetCheck>('/api/admin/mcsm/files/upload-check', {
        query: { ...context.target, path: context.path, name: decision.name },
        signal: controller.signal,
      })
    } finally {
      if (uploadCheckRequest === controller) uploadCheckRequest = null
    }
    if (!isCurrent()) return null
    if (typeof checked?.name !== 'string' || !checked.name || typeof checked.path !== 'string'
      || (checked.existing !== null && (typeof checked.existing?.name !== 'string'
        || ![0, 1].includes(checked.existing.type)))) {
      throw new Error('服务器未返回有效的文件名检查结果，已停止上传')
    }
    if (!checked.existing) return { name: checked.name, overwrite: false }
    const existing = checked.existing
    let action = decision.action || policy.action
    // 记住「替换」也不能覆盖目录；这种不同的问题仍需单独选择改名或取消。
    if (!action || (action === 'replace' && existing.type !== 1)) {
      task.status = 'conflict'
      const choice = await new Promise<UploadConflictChoice | null>((resolve) => {
        uploadConflictResolver = resolve
        uploadConflict.value = { path: context.path, existing }
        uploadApplyToRemaining.value = false
        applyDialogAnimation(uploadConflictDialog.value)
      })
      if (!isCurrent() || !choice) return null
      action = choice.action
      if (choice.applyToRemaining) policy.action = action
    }
    decision.action = action
    if (action === 'replace') return { name: existing.name, overwrite: true }
    // 自动逐个检查编号，遇到同名文件或目录都跳过，绝不改为覆盖。
    decision.name = suggestUploadName(checked.name)
  }
  return null
}

/**
 * 逐个分块上传。用 XHR 而不是 fetch，因为只有 XHR 能给上传进度；
 * 每个请求体保持很小；全部收齐后，API 再按面板协议分块写入守护进程。
 */
async function uploadFiles(files: File[], source: UploadSource = 'picker') {
  if (!files.length) return
  return uploadBatch(() => filesToUploadItems(files), source)
}

async function uploadBatch(collect: (isCurrent: () => boolean) => LocalUploadItem[] | Promise<LocalUploadItem[]>, source: UploadSource) {
  const context = captureFileContext()
  if (!context || !canUploadFiles.value || uploading.value) return
  const run = ++uploadRun
  const isCurrent = () => isFileContextCurrent(context) && run === uploadRun
  uploading.value = true
  uploadPreparing.value = true
  try {
    const collected = collect(isCurrent)
    const localItems = Array.isArray(collected) ? collected : await collected
    if (!isCurrent()) return
    const oversized = localItems.find(item => item.kind === 'file' && item.file.size > UPLOAD_MAX_BYTES)
    if (oversized?.kind === 'file') {
      showToast(`${oversized.file.name} 超过 256 MiB，无法上传`, 'error')
      return
    }
    const plan = createUploadPlan(localItems)
    if (!plan.length) return
    const appendPath = (parent: string, name: string) => parent === '/' ? `/${name}` : `${parent}/${name}`
    if (plan.some(item => appendPath(context.path, item.relativePath).length > 512)) {
      throw new Error('文件夹层级或文件路径过长，无法上传')
    }
    // 只对本次批次生效，不能在下一次上传或实例切换后沿用。
    const conflictPolicy: UploadConflictPolicy = { action: null }
    const firstTask = uploadTasks.value.length
    uploadTasks.value = [...uploadTasks.value, ...plan.map((item): UploadTask => ({
      id: ++uploadTaskId,
      kind: item.kind,
      originalName: item.name,
      name: item.name,
      size: item.kind === 'file' ? item.file.size : 0,
      path: item.parentPath ? appendPath(context.path, item.parentPath) : context.path,
      status: 'queued',
      percent: 0,
      message: '',
    }))]
    const batch = uploadTasks.value.slice(firstTask)
    // 只记已确认存在的目录；父目录失败时，子项绝不能退回根目录上传。
    const directoryPaths = new Map<string, string>([['', context.path]])
    uploadPreparing.value = false
    if (source !== 'picker' && !uploadQueueAutoOpenDismissed.value) {
      uploadQueueOpen.value = true
      uploadQueueAutoOpened.value = true
    }
    for (const [index, item] of plan.entries()) {
      if (!isCurrent()) return
      const task = batch[index]!
      try {
        const parent = directoryPaths.get(item.parentPath)
        if (parent === undefined) throw new Error(`父文件夹「${item.parentPath}」未成功创建，已跳过此项`)
        task.path = parent
        const targetContext = { ...context, path: parent }
        if (item.kind === 'directory') {
          task.status = 'creating'
          const controller = new AbortController()
          uploadCheckRequest = controller
          let directory: UploadDirectoryResult
          try {
            directory = await $fetch<UploadDirectoryResult>('/api/admin/mcsm/files/upload-directory', {
              method: 'POST', body: { ...context.target, path: parent, name: item.name }, signal: controller.signal,
            })
          } finally {
            if (uploadCheckRequest === controller) uploadCheckRequest = null
          }
          if (!isCurrent()) return
          if (directory?.ok !== true || typeof directory.name !== 'string' || !directory.name
            || /[/\\]/.test(directory.name) || directory.path !== appendPath(parent, directory.name)
            || typeof directory.created !== 'boolean') throw new Error('服务器未确认文件夹创建成功')
          directoryPaths.set(item.relativePath, directory.path)
          task.name = directory.name
          task.status = 'success'
          task.percent = 100
          task.message = directory.created ? '文件夹已创建' : '已合并到现有文件夹'
          continue
        }
        const decision: UploadFileDecision = { name: item.name, action: null }
        while (isCurrent()) {
          const destination = await chooseUploadDestination(decision, conflictPolicy, targetContext, isCurrent, task)
          if (!destination || !isCurrent()) {
            if (isCurrent()) cancelUpload()
            return
          }
          task.name = destination.name
          task.status = 'uploading'
          task.percent = 0
          try {
            await uploadOne(item.file, destination, targetContext, isCurrent, task)
          } catch (error: any) {
            if (isCurrent() && error?.code === 'MCSM_UPLOAD_CONFLICT') {
              // 名称被抢先占用时继续查重；已选自动改名的文件继续递增编号。
              decision.name = destination.name
              continue
            }
            throw error
          }
          if (!isCurrent()) return
          task.status = 'success'
          task.percent = 100
          showToast(`${destination.name} 已上传`)
          break
        }
      } catch (error: any) {
        if (!isCurrent()) return
        task.status = 'error'
        task.message = errorMessage(error, error?.message || '上传失败')
        showToast(`${task.name}：${task.message}`, 'error')
        // 单项失败不阻塞其他目录，失败原因保留在队列中。
      }
    }
    await loadList()
  } catch (error: any) {
    if (isCurrent() && error?.name !== 'AbortError') showToast(errorMessage(error, error?.message || '读取上传内容失败'), 'error')
  } finally {
    if (isCurrent()) {
      uploading.value = false
      uploadPreparing.value = false
      uploadRequest = null
    }
  }
}

async function uploadOne(file: File, destination: UploadDestination, context: FileRequestContext, isCurrent: () => boolean,
  task: UploadTask) {
  const chunkSize = 128 * 1024
  const uploadId = createUploadId()
  let offset = 0

  while (offset < file.size || (file.size === 0 && offset === 0)) {
    if (!isCurrent()) return
    const end = Math.min(file.size, offset + chunkSize)
    const chunk = file.slice(offset, end)
    const final = end === file.size
    await uploadChunk(file, destination, uploadId, offset, chunk, final, context, isCurrent, task)
    if (!isCurrent()) return
    offset = end
    task.percent = final ? 100 : Math.min(99, Math.round((offset / file.size) * 100))
    if (file.size === 0) break
  }
}

function createUploadId() {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof webCrypto?.getRandomValues === 'function') webCrypto.getRandomValues(bytes)
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256) })
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function uploadChunk(file: File, destination: UploadDestination, uploadId: string, offset: number, chunk: Blob, final: boolean,
  context: FileRequestContext, isCurrent: () => boolean, task: UploadTask) {
  return new Promise<void>((resolve, reject) => {
    const params = new URLSearchParams({
      ...context.target,
      path: context.path,
      name: destination.name,
      overwrite: destination.overwrite ? '1' : '0',
      uploadId,
      offset: String(offset),
      total: String(file.size),
      final: final ? '1' : '0',
    })
    const request = new XMLHttpRequest()
    const releaseRequest = () => { if (uploadRequest === request) uploadRequest = null }
    uploadRequest = request
    request.open('PUT', `/api/admin/mcsm/files/upload-chunk?${params.toString()}`)
    request.timeout = 12 * 60 * 1000
    request.setRequestHeader('Content-Type', 'application/octet-stream')
    request.upload.addEventListener('progress', (event) => {
      if (isCurrent() && uploadRequest === request && event.lengthComputable && file.size > 0) {
        // 100% 留给守护进程确认完成，不能把浏览器传到 API 等同于写入服务器。
        task.percent = Math.min(99, Math.round(((offset + event.loaded) / file.size) * 100))
        if (final && event.loaded >= chunk.size) task.status = 'finalizing'
      }
    })
    request.addEventListener('load', () => {
      releaseRequest()
      if (request.status >= 200 && request.status < 300) {
        try {
          const payload = JSON.parse(request.responseText)
          if (payload?.ok !== true || payload.complete !== final || payload.uploaded !== offset + chunk.size) {
            throw new Error('上传完成状态未得到服务器确认，请刷新目录后检查')
          }
          if (typeof payload.warning === 'string' && payload.warning && isCurrent()) showToast(payload.warning, 'error')
          resolve()
        } catch {
          reject(new Error('上传响应未确认完成，请刷新目录后检查'))
        }
        return
      }
      let message = `上传失败（${request.status}）`
      let conflict = false
      try {
        const payload = JSON.parse(request.responseText)
        if (payload?.statusMessage) message = payload.statusMessage
        conflict = request.status === 409 && payload?.data?.code === 'MCSM_UPLOAD_CONFLICT'
      } catch {
        // 非 JSON 响应就用默认文案。
      }
      reject(Object.assign(new Error(message), { code: conflict ? 'MCSM_UPLOAD_CONFLICT' : undefined }))
    })
    request.addEventListener('error', () => { releaseRequest(); reject(new Error('上传过程中网络中断')) })
    request.addEventListener('abort', () => { releaseRequest(); reject(new Error('上传已取消')) })
    request.addEventListener('timeout', () => { releaseRequest(); reject(new Error('上传等待超时，请刷新目录确认服务器是否已收到文件')) })
    if (file.size === 0) task.status = 'finalizing'
    request.send(chunk)
  })
}

function isUploadPending(task: UploadTask) {
  return !['success', 'error', 'cancelled'].includes(task.status)
}

function uploadTaskStatus(task: UploadTask) {
  return task.kind === 'directory' && task.status === 'success' ? '文件夹已就绪' : UPLOAD_STATUS_LABELS[task.status]
}

function clearFinishedUploads() {
  // 清除的只是本页记录，不会删除服务器文件，也不会中断正在上传的任务。
  uploadTasks.value = uploadTasks.value.filter(isUploadPending)
}

function cancelUpload() {
  uploadRun++
  uploadPreparing.value = false
  for (const task of uploadTasks.value) {
    if (!isUploadPending(task)) continue
    task.message = task.status === 'finalizing'
      ? '已停止等待；服务器可能仍在写入，请刷新目录确认结果。'
      : task.status === 'creating' ? '已停止等待；文件夹可能已创建，请刷新目录确认。'
        : task.status === 'queued' ? '未开始上传' : '上传已取消'
    task.status = 'cancelled'
  }
  uploadCheckRequest?.abort()
  uploadCheckRequest = null
  resolveUploadConflict(null)
  const request = uploadRequest
  uploadRequest = null
  request?.abort()
  uploading.value = false
}

function warnUploadBeforeUnload(event: BeforeUnloadEvent) {
  if (!uploading.value) return
  // 由浏览器显示原生离开确认；这里不能自定义 Chrome 的弹窗文案。
  event.preventDefault()
  event.returnValue = ''
}

watch(uploading, (active) => {
  if (active) uploadMenuOpen.value = false
  if (typeof window === 'undefined') return
  if (active) window.addEventListener('beforeunload', warnUploadBeforeUnload)
  else window.removeEventListener('beforeunload', warnUploadBeforeUnload)
}, { flush: 'sync' })

function resetFileState() {
  instanceGeneration++
  listRequestId++
  transferRequestId++
  cancelUpload()
  uploadMenuOpen.value = false
  uploadTasks.value = []
  items.value = []
  total.value = 0
  selectedNames.value = []
  path.value = '/'
  keyword.value = ''
  listLoading.value = false
  dragOver.value = false
  closeFileMenu()
  closePreview()
  previewTarget.value = null
  createOpen.value = false
  createName.value = ''
  createBusy.value = false
  renameTarget.value = null
  renameName.value = ''
  renameBusy.value = false
  transferMode.value = null
  transferDir.value = '/'
  transferBusy.value = false
  transferBrowsePath.value = '/'
  transferBrowseList.value = []
  transferBrowseLoading.value = false
  compressOpen.value = false
  compressName.value = ''
  compressBusy.value = false
  deleteOpen.value = false
  deleteBusy.value = false
  extractTarget.value = null
  extractFolderName.value = ''
  extractBusy.value = false
}

watch(instanceKey, (key) => {
  resetFileState()
  if (key) void loadList('/')
}, { flush: 'sync' })

onMounted(() => {
  window.addEventListener('keydown', onFullscreenKeydown)
  window.addEventListener('keydown', onSaveShortcut)
  window.addEventListener('scroll', onFileMenuScroll, true)
  window.addEventListener('resize', closeFileMenuOnResize)
  window.visualViewport?.addEventListener('resize', closeFileMenuOnResize)
  window.visualViewport?.addEventListener('scroll', closeFileMenuOnResize)
})

onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('beforeunload', warnUploadBeforeUnload)
  window.removeEventListener('keydown', onFullscreenKeydown)
  window.removeEventListener('keydown', onSaveShortcut)
  window.removeEventListener('scroll', onFileMenuScroll, true)
  window.removeEventListener('resize', closeFileMenuOnResize)
  window.visualViewport?.removeEventListener('resize', closeFileMenuOnResize)
  window.visualViewport?.removeEventListener('scroll', closeFileMenuOnResize)
  resetFileState()
})
</script>

<template>
  <div class="page page--wide api-redesign-page server-files-page">
    <div class="page-heading">
      <h1 class="page-title">服务器文件</h1>
      <md-icon-button aria-label="刷新" title="刷新" :disabled="refreshing || listLoading" @click="refreshPage">
        <md-icon>refresh</md-icon>
      </md-icon-button>
    </div>

    <section v-if="loading" class="card file-list-loading" role="status" aria-live="polite">
      <md-circular-progress indeterminate aria-hidden="true"></md-circular-progress>
      <div class="file-list-loading-copy">
        <span class="file-list-loading-title">正在读取文件信息</span>
        <span class="file-list-loading-note">正在连接服务器，请稍候…</span>
      </div>
    </section>

    <section v-else-if="loadError" class="card server-files-setup-empty">
      <EmptyState image="/images/empty-looking-for-answers.svg">
        <template #title>暂时无法读取管理实例</template>
        {{ loadError }}
      </EmptyState>
      <div class="form-actions">
        <md-outlined-button :disabled="refreshing" @click="refreshPage">重试</md-outlined-button>
        <md-text-button v-if="canConfigureMcsm" @click="goToSettings">检查站点设置</md-text-button>
      </div>
    </section>

    <section v-else-if="!configured" class="card server-files-setup-empty">
      <EmptyState image="/images/empty-looking-for-answers.svg">
        <template #title>尚未连接 MCSM 面板</template>
        请先到「站点设置」页填写 MCSManager 的面板地址与 ApiKey。
      </EmptyState>
      <div v-if="canConfigureMcsm" class="form-actions">
        <md-filled-button @click="goToSettings">
          <md-icon slot="icon">settings</md-icon>
          去站点设置
        </md-filled-button>
      </div>
    </section>

    <section v-else-if="!instanceConfigured" class="card server-files-setup-empty">
      <EmptyState image="/images/empty-looking-for-answers.svg">
        <template #title>尚未选择管理实例</template>
        请管理员在「站点设置 → MCSManager 面板」中选择管理实例后，再来管理文件。
      </EmptyState>
      <div v-if="canConfigureMcsm" class="form-actions">
        <md-filled-button @click="goToSettings">
          <md-icon slot="icon">settings</md-icon>
          去选择实例
        </md-filled-button>
      </div>
    </section>

    <div
      v-else-if="instance"
      :key="instanceKey"
      class="file-workspace"
      :class="{
        'file-workspace--with-uploads': uploadQueueOpen && (canUploadFiles || uploadTasks.length),
        'file-workspace--has-uploads': uploadTasks.length,
      }"
    >
      <section
        class="card browser"
        :class="{ 'browser--drag': dragOver }"
        aria-label="文件浏览与管理"
        @dragover.prevent="dragOver = canUploadFiles && !uploading"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
      >
        <div class="file-toolbar">
          <div class="file-tools">
            <span v-if="canUploadFiles" class="upload-menu-anchor">
              <md-filled-button
                id="file-upload-button"
                :disabled="uploading"
                aria-haspopup="menu"
                aria-controls="file-upload-menu"
                :aria-expanded="uploadMenuOpen"
                @click="toggleUploadMenu"
              >
                <md-icon slot="icon">upload</md-icon>
                <span class="upload-button-label">上传<md-icon aria-hidden="true">arrow_drop_down</md-icon></span>
              </md-filled-button>
              <md-menu
                id="file-upload-menu"
                anchor="file-upload-button"
                positioning="popover"
                anchor-corner="end-start"
                menu-corner="start-start"
                :open="uploadMenuOpen && !uploading"
                aria-label="选择上传类型"
                @closed="uploadMenuOpen = false"
              >
                <md-menu-item type="button" keep-open @click="pickFiles">
                  <md-icon slot="start">upload_file</md-icon>
                  <span slot="headline">上传文件</span>
                </md-menu-item>
                <md-menu-item type="button" keep-open @click="pickDirectory">
                  <md-icon slot="start">drive_folder_upload</md-icon>
                  <span slot="headline">上传文件夹</span>
                </md-menu-item>
              </md-menu>
            </span>
            <template v-if="canModifyFiles">
              <md-outlined-button @click="openCreate('directory')">
                <md-icon slot="icon">create_new_folder</md-icon>
                新建目录
              </md-outlined-button>
              <md-outlined-button @click="openCreate('file')">
                <md-icon slot="icon">note_add</md-icon>
                新建文件
              </md-outlined-button>
            </template>
          </div>
          <div class="file-search-tools">
            <md-outlined-text-field
              class="search"
              label="搜索当前目录"
              :value="keyword"
              @input="keyword = ($event.target as HTMLInputElement).value"
            >
              <md-icon slot="leading-icon">search</md-icon>
            </md-outlined-text-field>
            <md-icon-button
              v-if="canUploadFiles || uploadTasks.length"
              class="upload-queue-toggle"
              :class="{ 'upload-queue-toggle--open': uploadQueueOpen }"
              :aria-label="uploadQueueOpen ? '收起上传队列' : '展开上传队列'"
              :title="uploadQueueOpen ? '收起上传队列' : '展开上传队列'"
              :aria-expanded="uploadQueueOpen"
              aria-controls="upload-queue"
              @click="toggleUploadQueue"
            >
              <md-icon>cloud_upload</md-icon>
            </md-icon-button>
            <md-icon-button
              class="file-view-toggle"
              :class="{ 'file-view-toggle--active': fileView === 'grid' }"
              aria-label="大图标视图"
              :aria-pressed="fileView === 'grid'"
              :title="fileView === 'list' ? '切换到大图标视图' : '切换到列表视图'"
              @click="toggleFileView"
            >
              <md-icon>{{ fileView === 'list' ? 'grid_view' : 'view_list' }}</md-icon>
            </md-icon-button>
          </div>
        </div>

        <div class="file-location">
          <nav class="crumbs" aria-label="当前目录">
            <md-icon-button
              v-if="path !== '/'"
              aria-label="返回上一级"
              title="返回上一级"
              @click="loadList(parentPath)"
            >
              <md-icon>arrow_upward</md-icon>
            </md-icon-button>
            <md-text-button @click="loadList('/')">
              <md-icon slot="icon">folder_open</md-icon>
              根目录
            </md-text-button>
            <template v-for="crumb in crumbs" :key="crumb.path">
              <span class="crumb-sep">/</span>
              <md-text-button :title="crumb.path" @click="loadList(crumb.path)">
                <span class="crumb-name">{{ crumb.name }}</span>
              </md-text-button>
            </template>
          </nav>
          <span class="directory-count">{{ keyword.trim() ? `${visibleItems.length} / ${total}` : total }} 项</span>
        </div>

        <input
          ref="fileInput"
          type="file"
          multiple
          class="hidden-input"
          @change="onFilePicked"
        />
        <input
          ref="directoryInput"
          type="file"
          webkitdirectory
          multiple
          class="hidden-input"
          @change="onDirectoryPicked"
        />

        <div v-if="selectedEntries.length && !listLoading" class="bulk-bar">
          <span>已选中 {{ selectedEntries.length }} 项</span>
          <div class="bulk-actions">
            <md-text-button @click="downloadSelected">
              <md-icon slot="icon">download</md-icon>
              下载
            </md-text-button>
            <md-text-button v-if="canModifyFiles" @click="openTransfer('copy')">
              <md-icon slot="icon">content_copy</md-icon>
              复制到...
            </md-text-button>
            <md-text-button v-if="canModifyFiles" @click="openTransfer('move')">
              <md-icon slot="icon">drive_file_move</md-icon>
              移动到...
            </md-text-button>
            <md-text-button v-if="canModifyFiles" @click="openCompress">
              <md-icon slot="icon">folder_zip</md-icon>
              压缩
            </md-text-button>
            <md-text-button v-if="canDeleteFiles" class="danger" @click="deleteOpen = true">
              <md-icon slot="icon">delete</md-icon>
              删除
            </md-text-button>
          </div>
        </div>

        <div v-if="fileView === 'grid' && !listLoading" class="icon-view-toolbar">
          <label class="icon-view-select-all">
            <md-checkbox
              :checked="allVisibleSelected"
              :indeterminate="selectedEntries.length > 0 && !allVisibleSelected"
              aria-label="选择当前显示的全部文件"
              @change="toggleAll"
            ></md-checkbox>
            <span>全选</span>
          </label>
          <div class="icon-view-sorting" role="group" aria-label="文件排序">
            <button type="button" class="sort-button" :aria-pressed="sortField === 'name'" @click="setSort('name')">
              名称
              <md-icon v-if="sortField === 'name'">{{ sortAsc ? 'arrow_upward' : 'arrow_downward' }}</md-icon>
            </button>
            <button type="button" class="sort-button" :aria-pressed="sortField === 'size'" @click="setSort('size')">
              大小
              <md-icon v-if="sortField === 'size'">{{ sortAsc ? 'arrow_upward' : 'arrow_downward' }}</md-icon>
            </button>
            <button type="button" class="sort-button" :aria-pressed="sortField === 'time'" @click="setSort('time')">
              修改时间
              <md-icon v-if="sortField === 'time'">{{ sortAsc ? 'arrow_upward' : 'arrow_downward' }}</md-icon>
            </button>
          </div>
        </div>

        <div ref="filesTableWrap" :class="fileView === 'list' ? 'table-wrap' : 'icon-view-wrap'" :aria-busy="listLoading">
          <table v-if="fileView === 'list' && !listLoading" class="data-table">
            <thead>
              <tr>
                <th class="col-check">
                  <md-checkbox
                    :checked="allVisibleSelected"
                    :indeterminate="selectedEntries.length > 0 && !allVisibleSelected"
                    aria-label="选择当前显示的全部文件"
                    @change="toggleAll"
                  ></md-checkbox>
                </th>
                <th>
                  <button type="button" class="sort-button" @click="setSort('name')">
                    名称
                    <md-icon v-if="sortField === 'name'">{{ sortAsc ? 'arrow_upward' : 'arrow_downward' }}</md-icon>
                  </button>
                </th>
                <th class="col-size">
                  <button type="button" class="sort-button" @click="setSort('size')">
                    大小
                    <md-icon v-if="sortField === 'size'">{{ sortAsc ? 'arrow_upward' : 'arrow_downward' }}</md-icon>
                  </button>
                </th>
                <th class="col-time">
                  <button type="button" class="sort-button" @click="setSort('time')">
                    修改时间
                    <md-icon v-if="sortField === 'time'">{{ sortAsc ? 'arrow_upward' : 'arrow_downward' }}</md-icon>
                  </button>
                </th>
                <th class="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in visibleItems"
                :key="entry.name"
                :class="{ 'row--selected': selectedNames.includes(entry.name) }"
                @contextmenu.prevent.stop="openFileMenu($event, entry)"
                @keydown="onFileMenuKeydown($event, entry)"
              >
                <td class="col-check">
                  <md-checkbox
                    :checked="selectedNames.includes(entry.name)"
                    :aria-label="`选择 ${entry.name}`"
                    @change="toggleSelect(entry.name)"
                  ></md-checkbox>
                </td>
                <td class="name-cell">
                  <div class="name-cell-content">
                    <md-icon class="type-icon" :class="`type-icon--${entry.kind}`">
                      {{ KIND_ICONS[entry.kind] || 'draft' }}
                    </md-icon>
                    <button type="button" class="name-link file-entry-open" @click="openEntry(entry)">{{ entry.name }}</button>
                  </div>
                </td>
                <td class="col-size">{{ entry.kind === 'directory' ? '—' : formatBytes(entry.size) }}</td>
                <td class="col-time">{{ formatTime(entry.time) }}</td>
                <td class="cell-actions">
                  <div class="cell-actions-content desktop-actions">
                    <div class="actions-left">
                      <md-icon-button
                        v-if="canModifyFiles && isExtractable(entry)"
                        aria-label="解压"
                        title="解压"
                        @click="openExtract(entry)"
                      >
                        <md-icon>unarchive</md-icon>
                      </md-icon-button>
                    </div>
                    <div class="actions-right">
                      <md-icon-button
                        v-if="entry.kind !== 'directory'"
                        :aria-label="entry.editable && canModifyFiles ? '编辑' : '预览'"
                        :title="entry.editable && canModifyFiles ? '编辑' : '预览'"
                        @click="openPreview(entry)"
                      >
                        <md-icon>{{ entry.editable && canModifyFiles ? 'edit' : 'visibility' }}</md-icon>
                      </md-icon-button>
                      <md-icon-button
                        v-if="entry.kind !== 'directory'"
                        aria-label="下载"
                        title="下载"
                        :href="downloadUrl(entry)"
                      >
                        <md-icon>download</md-icon>
                      </md-icon-button>
                      <md-icon-button
                        v-if="canModifyFiles"
                        aria-label="复制到..."
                        title="复制到..."
                        @click="copySingle(entry)"
                      >
                        <md-icon>content_copy</md-icon>
                      </md-icon-button>
                      <md-icon-button
                        v-if="canModifyFiles"
                        aria-label="移动到..."
                        title="移动到..."
                        @click="moveSingle(entry)"
                      >
                        <md-icon>drive_file_move</md-icon>
                      </md-icon-button>
                      <md-icon-button v-if="canModifyFiles" aria-label="重命名" title="重命名" @click="openRename(entry)">
                        <md-icon>drive_file_rename_outline</md-icon>
                      </md-icon-button>
                      <md-icon-button v-if="canDeleteFiles" aria-label="删除" title="删除" @click="deleteSingle(entry)">
                        <md-icon>delete</md-icon>
                      </md-icon-button>
                    </div>
                  </div>
                  <div class="mobile-actions">
                    <md-icon-button
                      v-if="entry.kind !== 'directory'"
                      :aria-label="entry.editable && canModifyFiles ? '编辑' : '预览'"
                      :title="entry.editable && canModifyFiles ? '编辑' : '预览'"
                      @click="openPreview(entry)"
                    >
                      <md-icon>{{ entry.editable && canModifyFiles ? 'edit' : 'visibility' }}</md-icon>
                    </md-icon-button>
                    <md-icon-button
                      :aria-label="`${entry.name} 的更多操作`"
                      title="更多操作"
                      aria-haspopup="menu"
                      :aria-expanded="fileMenu?.entryName === entry.name"
                      @click.stop="openFileMenu($event, entry)"
                    >
                      <md-icon>more_vert</md-icon>
                    </md-icon-button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <ul v-else-if="!listLoading" class="file-icon-grid" aria-label="文件大图标视图">
            <li
              v-for="entry in visibleItems"
              :key="entry.name"
              class="file-icon-item"
              :class="{ 'file-icon-item--selected': selectedNames.includes(entry.name) }"
              @contextmenu.prevent.stop="openFileMenu($event, entry)"
              @keydown="onFileMenuKeydown($event, entry)"
            >
              <div class="file-icon-tools">
                <md-checkbox
                  :checked="selectedNames.includes(entry.name)"
                  :aria-label="`选择 ${entry.name}`"
                  @change="toggleSelect(entry.name)"
                ></md-checkbox>
                <md-icon-button
                  :aria-label="`${entry.name} 的更多操作`"
                  title="更多操作"
                  aria-haspopup="menu"
                  :aria-expanded="fileMenu?.entryName === entry.name"
                  @click.stop="openFileMenu($event, entry)"
                >
                  <md-icon>more_vert</md-icon>
                </md-icon-button>
              </div>
              <button
                type="button"
                class="file-icon-open file-entry-open"
                :title="`${entry.name}\n修改时间：${formatTime(entry.time)}`"
                @click="openEntry(entry)"
              >
                <span class="file-icon-symbol" :class="{ 'file-icon-symbol--folder': entry.kind === 'directory' }">
                  <md-icon class="type-icon" :class="`type-icon--${entry.kind}`" aria-hidden="true">
                    {{ KIND_ICONS[entry.kind] || 'draft' }}
                  </md-icon>
                </span>
                <span class="file-icon-name">{{ entry.name }}</span>
                <span class="file-icon-meta">{{ entry.kind === 'directory' ? '文件夹' : formatBytes(entry.size) }}</span>
              </button>
            </li>
          </ul>
          <div v-if="listLoading" class="file-list-loading" role="status" aria-live="polite">
            <md-circular-progress indeterminate aria-hidden="true"></md-circular-progress>
            <div class="file-list-loading-copy">
              <span class="file-list-loading-title">正在加载文件列表</span>
              <span class="file-list-loading-note">正在读取当前目录，请稍候…</span>
            </div>
          </div>
          <EmptyState v-else-if="!items.length" compact image="/images/empty-monitoring-data.svg">
            这个目录是空的
          </EmptyState>
          <EmptyState v-else-if="!visibleItems.length" compact image="/images/empty-looking-for-answers.svg">
            没有匹配「{{ keyword }}」的条目
          </EmptyState>
        </div>
        <AppScrollbar v-if="fileView === 'list' && !listLoading" :target="filesTableWrap" axis="horizontal" label="服务器文件表格横向滚动条" />
        <p v-if="canUploadFiles" class="file-browser-hint">
          <md-icon>drive_folder_upload</md-icon>
          可拖入文件或文件夹，保留目录结构；同名文件夹合并，文件重名时询问。单个文件最大 256 MiB。
        </p>
      </section>

      <section
        v-if="uploadQueueOpen && (canUploadFiles || uploadTasks.length)"
        id="upload-queue"
        class="card upload-panel"
        aria-labelledby="upload-panel-title"
      >
        <div class="upload-panel-heading">
          <h2 id="upload-panel-title" class="card-title">
            <md-icon>cloud_upload</md-icon>
            上传队列
          </h2>
          <md-icon-button
            v-if="finishedUploadCount"
            aria-label="清除已结束的上传记录"
            title="清除已结束的记录，不会删除服务器文件"
            @click="clearFinishedUploads"
          >
            <md-icon>playlist_remove</md-icon>
          </md-icon-button>
        </div>

        <template v-if="uploadTasks.length || uploadPreparing">
          <div class="upload-summary">
            <div class="upload-summary-counts" role="status">
              <span v-if="uploadPreparing">正在读取文件夹…</span>
              <span v-else>已完成 {{ uploadSummary.success }} / {{ uploadSummary.total }} 项</span>
              <span v-if="uploadSummary.pending">{{ uploadSummary.pending }} 个待完成</span>
              <span v-if="uploadSummary.failed" class="danger">{{ uploadSummary.failed }} 个失败</span>
              <span v-if="uploadSummary.cancelled">{{ uploadSummary.cancelled }} 个已取消</span>
            </div>
            <md-text-button v-if="uploading" @click="cancelUpload">取消全部</md-text-button>
          </div>

          <ul ref="uploadList" class="upload-list" aria-label="文件和文件夹上传记录">
            <li v-for="task in orderedUploadTasks" :key="task.id" class="upload-task" :class="`upload-task--${task.status}`">
              <div class="upload-task-heading">
                <md-icon class="upload-task-icon">{{ UPLOAD_STATUS_ICONS[task.status] }}</md-icon>
                <div class="upload-task-info">
                  <span class="upload-task-name" :title="task.name">{{ task.name }}</span>
                  <span class="upload-task-meta" :title="`上传目录：${task.path}`">
                    {{ task.kind === 'directory' ? '文件夹' : task.size === 0 ? '0 B' : formatBytes(task.size) }} · {{ task.path === '/' ? '根目录' : task.path }}
                  </span>
                </div>
              </div>
              <div class="upload-task-state">
                <span>{{ uploadTaskStatus(task) }}</span>
                <span v-if="task.percent || task.status === 'uploading' || task.status === 'finalizing'" class="upload-percent">
                  {{ task.percent }}%
                </span>
              </div>
              <div
                class="upload-progress"
                role="progressbar"
                :aria-label="`${task.name}：${uploadTaskStatus(task)}`"
                :aria-valuenow="task.percent"
                :aria-valuetext="`${uploadTaskStatus(task)}，${task.percent}%`"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <div class="upload-progress-fill" :style="{ width: task.percent + '%' }"></div>
              </div>
              <p v-if="task.name !== task.originalName" class="upload-task-detail">原文件名：{{ task.originalName }}</p>
              <p v-if="task.message" class="upload-task-message">{{ task.message }}</p>
            </li>
          </ul>
          <AppScrollbar :target="uploadList" label="上传队列滚动条" />
          <p class="upload-panel-note">仅保留本页记录，清除记录不会删除服务器文件。</p>
        </template>
        <div v-else class="upload-empty">
          <span class="upload-empty-icon"><md-icon>upload_file</md-icon></span>
          <div>
            <p class="upload-empty-title">暂无上传任务</p>
            <p>选择文件、文件夹或拖入文件区后，可在这里查看创建目录和上传文件的进度。</p>
          </div>
        </div>
      </section>
    </div>

    <Teleport v-if="fileMenu" to="body">
      <span
        id="file-context-anchor"
        class="file-context-anchor"
        :style="{ left: fileMenu.left + 'px', top: fileMenu.top + 'px' }"
        aria-hidden="true"
      ></span>
      <md-menu
        :key="fileMenu.id"
        ref="fileMenuElement"
        class="file-context-menu"
        :style="{ '--file-menu-available-width': fileMenu.bounds.width + 'px', '--file-menu-available-height': fileMenu.bounds.height + 'px' }"
        :data-menu-id="fileMenu.id"
        anchor="file-context-anchor"
        positioning="fixed"
        anchor-corner="start-start"
        menu-corner="start-start"
        no-horizontal-flip
        no-vertical-flip
        :open="true"
        quick
        :aria-label="fileMenu.selectionMode ? `已选中 ${fileMenuEntries.length} 项的操作` : `${fileMenu.entryName} 的操作`"
        @opening="positionFileMenu"
        @closed="onFileMenuClosed"
        @contextmenu.prevent
      >
        <div class="file-context-heading" aria-hidden="true">
          {{ fileMenu.selectionMode ? `已选中 ${fileMenuEntries.length} 项` : fileMenu.entryName }}
        </div>
        <!-- 操作处理函数统一关闭菜单，避免组件提前清空操作目标；按钮支持回车和空格。 -->
        <md-menu-item v-if="fileMenuSingle" type="button" keep-open @click="runFileMenuAction('open')">
          <md-icon slot="start">{{ fileMenuSingle.kind === 'directory' ? 'folder_open' : fileMenuSingle.editable && canModifyFiles ? 'edit' : 'visibility' }}</md-icon>
          <span slot="headline">{{ fileMenuSingle.kind === 'directory' ? '打开文件夹' : fileMenuSingle.editable && canModifyFiles ? '编辑' : '预览' }}</span>
        </md-menu-item>
        <md-menu-item v-if="!fileMenuSingle || fileMenuSingle.kind !== 'directory'" type="button" keep-open @click="runFileMenuAction('download')">
          <md-icon slot="start">download</md-icon>
          <span slot="headline">下载</span>
        </md-menu-item>
        <template v-if="canModifyFiles">
          <md-menu-item type="button" keep-open @click="runFileMenuAction('copy')">
            <md-icon slot="start">content_copy</md-icon>
            <span slot="headline">复制到…</span>
          </md-menu-item>
          <md-menu-item type="button" keep-open @click="runFileMenuAction('move')">
            <md-icon slot="start">drive_file_move</md-icon>
            <span slot="headline">移动到…</span>
          </md-menu-item>
          <md-menu-item v-if="fileMenuSingle" type="button" keep-open @click="runFileMenuAction('rename')">
            <md-icon slot="start">drive_file_rename_outline</md-icon>
            <span slot="headline">重命名</span>
          </md-menu-item>
          <md-menu-item type="button" keep-open @click="runFileMenuAction('compress')">
            <md-icon slot="start">folder_zip</md-icon>
            <span slot="headline">压缩为 ZIP</span>
          </md-menu-item>
          <md-menu-item v-if="fileMenuSingle && isExtractable(fileMenuSingle)" type="button" keep-open @click="runFileMenuAction('extract')">
            <md-icon slot="start">unarchive</md-icon>
            <span slot="headline">解压</span>
          </md-menu-item>
        </template>
        <md-menu-item v-if="canDeleteFiles" class="file-context-delete" type="button" keep-open @click="runFileMenuAction('delete')">
          <md-icon slot="start">delete</md-icon>
          <span slot="headline">删除</span>
        </md-menu-item>
        <md-divider></md-divider>
        <template v-if="fileMenu.selectionMode">
          <md-menu-item type="button" keep-open @click="runFileMenuAction('select-all')">
            <md-icon slot="start">select_all</md-icon>
            <span slot="headline">全选</span>
          </md-menu-item>
          <md-menu-item type="button" keep-open @click="runFileMenuAction('invert')">
            <md-icon slot="start">flip_to_back</md-icon>
            <span slot="headline">反选</span>
          </md-menu-item>
          <md-menu-item type="button" keep-open @click="runFileMenuAction('clear')">
            <md-icon slot="start">deselect</md-icon>
            <span slot="headline">取消选择</span>
          </md-menu-item>
        </template>
        <md-menu-item v-else type="button" keep-open @click="runFileMenuAction('select')">
          <md-icon slot="start">check_box</md-icon>
          <span slot="headline">选择此项</span>
        </md-menu-item>
      </md-menu>
    </Teleport>

    <md-dialog ref="previewDialog" class="file-preview-dialog" :open="previewOpen" @closed="previewOpen = false">
      <div slot="headline" class="preview-headline">
        <span class="preview-name">{{ previewTarget?.name }}</span>
        <span class="preview-actions">
          <md-icon-button aria-label="网页全屏" title="网页全屏" @click="enterFullscreen">
            <md-icon>fullscreen</md-icon>
          </md-icon-button>
          <a
            v-if="previewTarget"
            class="plain-link"
            :href="previewPageUrl(previewTarget)"
            target="_blank"
            rel="noopener"
          >
            <md-icon-button aria-label="在新页面打开" title="在新页面打开">
              <md-icon>open_in_new</md-icon>
            </md-icon-button>
          </a>
        </span>
      </div>
      <div slot="content" class="preview-body">
        <FilePreview
          v-if="previewTarget && previewOpen"
          :key="`${instanceKey}:${fullPath(previewTarget.name)}`"
          ref="previewRef"
          :uuid="requestBase().uuid"
          :daemon-id="requestBase().daemonId"
          :path="fullPath(previewTarget.name)"
          :kind="previewTarget.kind"
          :size="previewTarget.size"
          :can-edit="canModifyFiles"
          @saved="loadList()"
        />
      </div>
      <div slot="actions">
        <md-filled-button
          v-if="previewTarget?.editable && canModifyFiles"
          :disabled="!previewRef?.dirty"
          @click="savePreviewFile"
        >
          <md-icon slot="icon">save</md-icon>
          保存
        </md-filled-button>
        <a v-if="previewTarget" class="plain-link" :href="downloadUrl(previewTarget)">
          <md-text-button>下载</md-text-button>
        </a>
        <md-text-button @click="closePreview">关闭</md-text-button>
      </div>
    </md-dialog>

    <div v-if="previewFullscreen && previewTarget" class="fullscreen-layer">
      <header class="fullscreen-bar">
        <md-icon class="type-icon">{{ KIND_ICONS[previewTarget.kind] || 'draft' }}</md-icon>
        <span class="fullscreen-name">{{ fullPath(previewTarget.name) }}</span>
        <md-filled-button
          v-if="previewTarget.editable && canModifyFiles"
          :disabled="!previewRef?.dirty"
          @click="savePreviewFile"
        >
          <md-icon slot="icon">save</md-icon>
          保存
        </md-filled-button>
        <a class="plain-link" :href="downloadUrl(previewTarget)">
          <md-icon-button aria-label="下载" title="下载">
            <md-icon>download</md-icon>
          </md-icon-button>
        </a>
        <a class="plain-link" :href="previewPageUrl(previewTarget)" target="_blank" rel="noopener">
          <md-icon-button aria-label="在新页面打开" title="在新页面打开">
            <md-icon>open_in_new</md-icon>
          </md-icon-button>
        </a>
        <md-icon-button aria-label="退出全屏（Esc）" title="退出全屏（Esc）" @click="exitFullscreen">
          <md-icon>fullscreen_exit</md-icon>
        </md-icon-button>
      </header>
      <div ref="fullscreenBody" class="fullscreen-body">
        <FilePreview
          :key="`${instanceKey}:${fullPath(previewTarget.name)}`"
          ref="previewRef"
          :uuid="requestBase().uuid"
          :daemon-id="requestBase().daemonId"
          :path="fullPath(previewTarget.name)"
          :kind="previewTarget.kind"
          :size="previewTarget.size"
          :can-edit="canModifyFiles"
          editor-height="calc(100dvh - 190px)"
          @saved="loadList()"
        />
      </div>
      <AppScrollbar :target="fullscreenBody" label="全屏文件区域滚动条" />
      <AppScrollbar :target="fullscreenBody" axis="horizontal" label="全屏文件区域横向滚动条" />
    </div>

    <md-dialog ref="createDialog" :open="createOpen" @closed="createOpen = false">
      <md-icon slot="icon">{{ createKind === 'directory' ? 'create_new_folder' : 'note_add' }}</md-icon>
      <div slot="headline">{{ createKind === 'directory' ? '新建目录' : '新建文件' }}</div>
      <div slot="content" class="dialog-form">
        <p class="card-note">将创建在 <code>{{ path }}</code> 下。</p>
        <md-outlined-text-field
          label="名称"
          :value="createName"
          @input="createName = ($event.target as HTMLInputElement).value"
          @keydown.enter="submitCreate"
        ></md-outlined-text-field>
      </div>
      <div slot="actions">
        <md-text-button :disabled="createBusy" @click="createOpen = false">取消</md-text-button>
        <md-text-button :disabled="createBusy || !createName.trim()" @click="submitCreate">
          {{ createBusy ? '创建中…' : '创建' }}
        </md-text-button>
      </div>
    </md-dialog>

    <md-dialog ref="renameDialog" :open="!!renameTarget" @closed="renameTarget = null">
      <md-icon slot="icon">drive_file_rename_outline</md-icon>
      <div slot="headline">重命名</div>
      <div slot="content" class="dialog-form">
        <md-outlined-text-field
          label="新名称"
          :value="renameName"
          @input="renameName = ($event.target as HTMLInputElement).value"
          @keydown.enter="submitRename"
        ></md-outlined-text-field>
      </div>
      <div slot="actions">
        <md-text-button :disabled="renameBusy" @click="renameTarget = null">取消</md-text-button>
        <md-text-button :disabled="renameBusy || !renameName.trim()" @click="submitRename">
          {{ renameBusy ? '处理中…' : '确定' }}
        </md-text-button>
      </div>
    </md-dialog>

    <md-dialog
      ref="uploadConflictDialog"
      class="upload-conflict-dialog"
      :open="!!uploadConflict"
      @cancel.prevent="cancelUpload"
    >
      <md-icon slot="icon">file_copy</md-icon>
      <div slot="headline">{{ uploadConflict?.existing.type === 1 ? '已存在同名文件' : '名称已被目录占用' }}</div>
      <div slot="content" class="dialog-form">
        <p class="card-note upload-conflict-note">
          目标目录 <code>{{ uploadConflict?.path }}</code> 已有{{ uploadConflict?.existing.type === 1 ? '文件' : '目录' }}
          <strong>{{ uploadConflict?.existing.name }}</strong>。
        </p>
        <p v-if="uploadConflict?.existing.type === 1" class="card-note">替换将覆盖现有文件的内容。</p>
        <p class="card-note">改名会在文件名后、扩展名前自动添加「 (1)」，仍有重名则递增为「 (2)」「 (3)」等，保留已有文件或目录。</p>
        <label for="upload-apply-to-remaining" class="upload-conflict-remember">
          <md-checkbox
            id="upload-apply-to-remaining"
            :checked="uploadApplyToRemaining"
            @change="uploadApplyToRemaining = ($event.target as HTMLInputElement).checked"
          ></md-checkbox>
          <span>对后续的文件同样的问题也执行该操作，不再询问</span>
        </label>
        <p class="card-note">仅对本次上传生效，同名目录不能被替换。</p>
      </div>
      <div slot="actions" class="upload-conflict-actions">
        <md-text-button @click="cancelUpload">取消上传</md-text-button>
        <md-outlined-button @click="confirmUploadRename">自动改名</md-outlined-button>
        <md-filled-button v-if="uploadConflict?.existing.type === 1" class="upload-replace-button" @click="confirmUploadReplacement">替换文件</md-filled-button>
      </div>
    </md-dialog>

    <md-dialog ref="transferDialog" :open="!!transferMode" @closed="transferMode = null">
      <md-icon slot="icon">{{ transferMode === 'copy' ? 'content_copy' : 'drive_file_move' }}</md-icon>
      <div slot="headline">{{ transferMode === 'copy' ? '复制到' : '移动到' }}</div>
      <div slot="content" class="dialog-form">
        <p class="card-note">同名文件会被覆盖。</p>
        <md-outlined-text-field
          label="目标目录"
          :value="transferDir"
          @input="transferDir = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <div class="transfer-browser">
          <div class="transfer-browser-header">
            <div class="transfer-crumbs">
              <md-text-button @click="loadTransferBrowseList('/')">
                <md-icon slot="icon">home</md-icon>
                根目录
              </md-text-button>
              <template v-for="(segment, i) in transferBrowsePath.split('/').filter(Boolean)" :key="i">
                <span class="crumb-sep">/</span>
                <md-text-button
                  @click="loadTransferBrowseList('/' + transferBrowsePath.split('/').filter(Boolean).slice(0, i + 1).join('/'))"
                >
                  {{ segment }}
                </md-text-button>
              </template>
            </div>
          </div>

          <div v-if="transferBrowseLoading" class="transfer-browser-loading">
            <md-circular-progress indeterminate></md-circular-progress>
            <span>加载中…</span>
          </div>

          <div v-else ref="transferBrowserList" class="transfer-browser-list">
            <div
              v-if="transferBrowsePath !== '/'"
              class="transfer-item transfer-item--up"
              @click="loadTransferBrowseList(transferBrowsePath.split('/').slice(0, -1).join('/') || '/')"
            >
              <md-icon>arrow_upward</md-icon>
              <span>返回上一级</span>
            </div>

            <EmptyState v-if="!transferBrowseList.length" class="transfer-browser-empty" compact image="/images/empty-monitoring-data.svg">
              此目录下没有子目录
            </EmptyState>

            <div
              v-for="dir in transferBrowseList"
              :key="dir.name"
              class="transfer-item"
              :class="{ 'transfer-item--selected': transferDir === (transferBrowsePath === '/' ? `/${dir.name}` : `${transferBrowsePath}/${dir.name}`) }"
              @click="selectTransferDir(dir.name)"
              @dblclick="loadTransferBrowseList(transferBrowsePath === '/' ? `/${dir.name}` : `${transferBrowsePath}/${dir.name}`)"
            >
              <md-icon>folder</md-icon>
              <span class="transfer-item-name">{{ dir.name }}</span>
              <md-icon-button
                aria-label="进入"
                title="进入此目录"
                @click.stop="loadTransferBrowseList(transferBrowsePath === '/' ? `/${dir.name}` : `${transferBrowsePath}/${dir.name}`)"
              >
                <md-icon>chevron_right</md-icon>
              </md-icon-button>
            </div>
          </div>
          <AppScrollbar :target="transferBrowserList" label="目标目录列表滚动条" />
        </div>

        <div class="quick-dirs">
          <md-text-button @click="transferDir = '/'">根目录</md-text-button>
          <md-text-button v-if="path !== '/'" @click="transferDir = path">当前目录</md-text-button>
          <md-text-button v-if="path !== '/' && parentPath !== '/'" @click="transferDir = parentPath">
            上级目录
          </md-text-button>
        </div>
      </div>
      <div slot="actions">
        <md-text-button :disabled="transferBusy" @click="transferMode = null">取消</md-text-button>
        <md-text-button :disabled="transferBusy" @click="submitTransfer">
          {{ transferBusy ? '处理中…' : '确定' }}
        </md-text-button>
      </div>
    </md-dialog>

    <md-dialog ref="compressDialog" :open="compressOpen" @closed="compressOpen = false">
      <md-icon slot="icon">folder_zip</md-icon>
      <div slot="headline">压缩为 zip</div>
      <div slot="content" class="dialog-form">
        <p class="card-note">运行中被占用的文件无法压缩。大目录压缩可能先超时；任务仍会在面板侧继续，稍后刷新查看。</p>
        <md-outlined-text-field
          label="压缩包名"
          supporting-text="必须以 .zip 结尾"
          :value="compressName"
          @input="compressName = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
      </div>
      <div slot="actions">
        <md-text-button :disabled="compressBusy" @click="compressOpen = false">取消</md-text-button>
        <md-text-button :disabled="compressBusy || !compressName.trim()" @click="submitCompress">
          {{ compressBusy ? '压缩中…' : '开始压缩' }}
        </md-text-button>
      </div>
    </md-dialog>

    <ConfirmDialog
      :open="deleteOpen"
      title="删除文件"
      :message="`确定要删除选中的 ${selectedEntries.length} 项吗？目录会连同内容一起删除，面板侧没有回收站，无法恢复。`"
      icon="delete"
      confirm-label="删除"
      pending-label="删除中…"
      destructive
      :pending="deleteBusy"
      @confirm="confirmDelete"
      @cancel="deleteOpen = false"
      @closed="deleteOpen = false"
    >
      <ul class="delete-list">
        <li v-for="entry in selectedEntries.slice(0, 8)" :key="entry.name">{{ entry.name }}</li>
        <li v-if="selectedEntries.length > 8">…等 {{ selectedEntries.length }} 项</li>
      </ul>
    </ConfirmDialog>

    <md-dialog ref="extractDialog" :open="!!extractTarget" @closed="extractTarget = null">
      <md-icon slot="icon">unarchive</md-icon>
      <div slot="headline">解压文件</div>
      <div slot="content" class="dialog-form">
        <p class="card-note">
          将「<strong>{{ extractTarget?.name }}</strong>」解压到 <code>{{ path }}</code>
        </p>

        <div class="extract-options">
          <label class="extract-option" :class="{ 'extract-option--selected': extractMode === 'current' }">
            <input type="radio" name="extractMode" value="current" v-model="extractMode" />
            <div class="extract-option-content">
              <div class="extract-option-title">
                <md-icon>folder_open</md-icon>
                <span>直接解压到当前目录</span>
              </div>
              <div class="extract-option-desc">
                文件会散落在 <code>{{ path }}</code> 下，可能与现有文件混在一起
              </div>
            </div>
          </label>

          <label class="extract-option" :class="{ 'extract-option--selected': extractMode === 'folder' }">
            <input type="radio" name="extractMode" value="folder" v-model="extractMode" />
            <div class="extract-option-content">
              <div class="extract-option-title">
                <md-icon>create_new_folder</md-icon>
                <span>创建文件夹后解压</span>
              </div>
            </div>
          </label>
        </div>

        <md-outlined-text-field
          v-if="extractMode === 'folder'"
          label="文件夹名称"
          supporting-text="将在当前目录下创建此文件夹"
          :value="extractFolderName"
          @input="extractFolderName = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <p v-if="extractMode === 'current'" class="card-note" style="color: var(--md-sys-color-error);">
          ⚠️ 同名文件会被覆盖
        </p>
      </div>
      <div slot="actions">
        <md-text-button :disabled="extractBusy" @click="extractTarget = null">取消</md-text-button>
        <md-filled-button :disabled="extractBusy || (extractMode === 'folder' && !extractFolderName.trim())" @click="confirmExtract">
          {{ extractBusy ? '解压中…' : '开始解压' }}
        </md-filled-button>
      </div>
    </md-dialog>
  </div>
</template>

<style scoped>
.server-files-page .page-heading { display: flex; justify-content: space-between; align-items: center; flex-direction: row; gap: 16px; }
.server-files-page .page-heading > md-icon-button { flex: 0 0 auto; align-self: center; }
.card + .card { margin-top: 20px; }
.card-note { margin: 8px 0 0; font-size: 13px; line-height: 1.7; color: var(--md-sys-color-on-surface-variant); }
.card-note code { padding: 1px 5px; border-radius: 4px; background: var(--md-sys-color-surface); font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.form-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 14px; }
.file-workspace { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: 16px; }
.file-workspace > .card { min-width: 0; margin: 0; padding: 20px; }
.browser { transition: outline-color 160ms ease; outline: 2px dashed transparent; outline-offset: -6px; }
.browser--drag { outline-color: var(--md-sys-color-primary); }
.file-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.file-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.upload-menu-anchor { position: relative; display: inline-flex; }
.upload-button-label { display: inline-flex; align-items: center; gap: 4px; }
.file-search-tools { display: flex; align-items: center; gap: 8px; flex: 1 1 300px; min-width: 0; max-width: 376px; margin-left: auto; }
.search { flex: 1 1 0; width: 100%; min-width: 0; }
.upload-queue-toggle, .file-view-toggle { flex: 0 0 auto; border-radius: 8px; }
.upload-queue-toggle--open, .file-view-toggle--active { --md-icon-button-icon-color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); }
.file-location { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; padding: 8px 0; border-top: 1px solid var(--md-sys-color-outline-variant); }
.crumbs { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; min-width: 0; flex: 1; }
.crumbs md-text-button { max-width: 100%; min-width: 0; }
.crumb-name { display: block; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crumb-sep { color: var(--md-sys-color-on-surface-variant); }
.directory-count { flex: 0 0 auto; color: var(--md-sys-color-on-surface-variant); font-size: 12px; font-variant-numeric: tabular-nums; }
.file-browser-hint { display: flex; align-items: center; gap: 8px; margin: 16px 0 0; color: var(--md-sys-color-on-surface-variant); font-size: 12px; line-height: 1.6; }
.file-browser-hint md-icon { flex: 0 0 auto; --md-icon-size: 18px; }
.hidden-input { display: none; }
.upload-panel { position: sticky; top: 16px; }
.upload-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; }
.upload-panel-heading .card-title { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 16px; }
.upload-panel-heading .card-title md-icon { color: var(--md-sys-color-primary); --md-icon-size: 22px; }
.upload-panel-heading > md-icon-button { flex: 0 0 auto; }
.upload-summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 8px 0 12px; }
.upload-summary-counts { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; color: var(--md-sys-color-on-surface-variant); font-size: 12px; line-height: 1.7; }
.upload-summary-counts > :first-child { flex-basis: 100%; font-weight: 500; color: var(--md-sys-color-on-surface); }
.upload-summary md-text-button { flex: 0 0 auto; }
.upload-list { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; max-height: clamp(160px, calc(100dvh - 340px), 480px); overflow-y: auto; overscroll-behavior: contain; list-style: none; }
.upload-task { --upload-state-color: var(--md-sys-color-primary); padding: 12px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface-container-low); }
.upload-task--queued, .upload-task--cancelled { --upload-state-color: var(--md-sys-color-on-surface-variant); }
.upload-task--conflict { --upload-state-color: var(--md-sys-color-tertiary); }
.upload-task--error { --upload-state-color: var(--md-sys-color-error); }
.upload-task-heading { display: flex; align-items: flex-start; gap: 10px; }
.upload-task-icon { flex: 0 0 auto; margin-top: 2px; color: var(--upload-state-color); --md-icon-size: 22px; }
.upload-task-info { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 0; }
.upload-task-name { overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; font-weight: 500; }
.upload-task-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--md-sys-color-on-surface-variant); font-size: 11px; line-height: 1.5; }
.upload-task-state { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; color: var(--upload-state-color); font-size: 12px; }
.upload-progress { height: 4px; margin-top: 8px; border-radius: 999px; background: var(--md-sys-color-outline-variant); overflow: hidden; }
.upload-progress-fill { height: 100%; background: var(--upload-state-color); transition: width 120ms linear; }
.upload-task-detail, .upload-task-message, .upload-panel-note { margin: 10px 0 0; color: var(--md-sys-color-on-surface-variant); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.upload-task--error .upload-task-message { color: var(--md-sys-color-error); }
.upload-panel-note { margin-top: 14px; }
.upload-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 28px 4px 16px; text-align: center; }
.upload-empty-icon { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 16px; background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); }
.upload-empty-icon md-icon { --md-icon-size: 28px; }
.upload-empty p { margin: 6px 0 0; color: var(--md-sys-color-on-surface-variant); font-size: 12px; line-height: 1.7; }
.upload-empty .upload-empty-title { margin: 0; color: var(--md-sys-color-on-surface); font-size: 14px; font-weight: 500; }
.upload-percent { font-variant-numeric: tabular-nums; }
.upload-conflict-dialog { max-width: min(520px, calc(100vw - 32px)); }
.upload-conflict-note { overflow-wrap: anywhere; }
.upload-conflict-remember { display: flex; align-items: center; gap: 10px; line-height: 1.6; cursor: pointer; }
.upload-conflict-remember md-checkbox { flex: 0 0 auto; }
.upload-conflict-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.upload-replace-button { --md-filled-button-container-color: var(--md-sys-color-error); --md-filled-button-label-text-color: var(--md-sys-color-on-error); }
.bulk-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 14px; padding: 8px 14px; border-radius: 8px; background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); font-size: 13px; }
.bulk-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.danger { color: var(--md-sys-color-error); }
.table-wrap { overflow-x: auto; margin-top: 4px; }
.data-table { width: 100%; min-width: 820px; border-collapse: collapse; table-layout: fixed; }
.data-table th, .data-table td { min-width: 0; padding: 8px 10px; border-bottom: 1px solid var(--md-sys-color-outline-variant); text-align: left; vertical-align: middle; }
.data-table th { color: var(--md-sys-color-on-surface-variant); font-size: 12px; font-weight: 500; white-space: nowrap; }
.col-check { width: 44px; }
.data-table th:nth-child(2), .data-table td:nth-child(2) { width: auto; }
.data-table th:nth-child(3), .data-table td:nth-child(3) { width: 82px; }
.data-table th:nth-child(4), .data-table td:nth-child(4) { width: 142px; }
.data-table th:nth-child(5), .data-table td:nth-child(5) { width: 292px; }
.col-size, .col-time { white-space: nowrap; }
.col-time { font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.col-actions { width: 1%; white-space: nowrap; text-align: right; padding-right: 8px !important; }
.sort-button { display: inline-flex; align-items: center; gap: 4px; border: 0; padding: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
.sort-button md-icon { --md-icon-size: 16px; }
.sort-button:focus-visible, .file-entry-open:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: 3px; border-radius: 4px; }
.row--selected { background: color-mix(in srgb, var(--md-sys-color-secondary-container) 55%, transparent); }
.name-cell { padding: 0 !important; min-width: 0; }
.name-cell-content { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; box-sizing: border-box; overflow: hidden; padding: 8px 10px; }
.type-icon { flex: 0 0 auto; --md-icon-size: 20px; color: var(--md-sys-color-on-surface-variant); }
.type-icon--directory { color: var(--md-sys-color-primary); }
.name-link { display: block; flex: 1 1 auto; min-width: 0; max-width: 100%; border: 0; padding: 0; background: none; color: var(--md-sys-color-on-surface); font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; cursor: pointer; text-align: left; overflow-wrap: anywhere; word-break: break-word; white-space: normal; hyphens: auto; }
.name-link:hover { color: var(--md-sys-color-primary); text-decoration: underline; }
.cell-actions { text-align: right; white-space: nowrap; padding-right: 4px !important; }
.cell-actions-content { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.mobile-actions { display: none; position: relative; justify-content: flex-end; }
.actions-left { display: flex; align-items: center; flex-shrink: 0; }
.actions-right { display: flex; align-items: center; flex-shrink: 0; margin-left: auto; }
.icon-view-wrap { min-width: 0; }
.icon-view-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; padding: 6px 0; margin-top: 4px; border-bottom: 1px solid var(--md-sys-color-outline-variant); color: var(--md-sys-color-on-surface-variant); font-size: 12px; }
.icon-view-select-all { display: inline-flex; align-items: center; gap: 10px; padding-inline: 10px; cursor: pointer; }
.icon-view-sorting { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.icon-view-sorting .sort-button { min-height: 36px; padding: 0 10px; border-radius: 8px; }
.icon-view-sorting .sort-button[aria-pressed="true"] { background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); }
.file-icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(132px, 100%), 1fr)); gap: 12px; margin: 0; padding: 16px 0 4px; list-style: none; }
.file-icon-item { display: flex; flex-direction: column; min-width: 0; border: 1px solid transparent; border-radius: 12px; transition: background 150ms, border-color 150ms; }
.file-icon-item:hover { background: var(--md-sys-color-surface-container-low); }
.file-icon-item--selected, .file-icon-item--selected:hover { border-color: var(--md-sys-color-primary); background: color-mix(in srgb, var(--md-sys-color-secondary-container) 65%, transparent); }
.file-icon-tools { display: flex; align-items: center; justify-content: space-between; gap: 4px; min-height: 40px; padding: 0 4px 0 10px; }
.file-icon-open { display: flex; flex: 1; flex-direction: column; align-items: center; gap: 8px; width: 100%; min-width: 0; padding: 0 10px 14px; border: 0; border-radius: 8px; background: none; color: var(--md-sys-color-on-surface); font: inherit; text-align: center; cursor: pointer; }
.file-icon-open:focus-visible { outline-offset: -2px; }
.file-icon-symbol { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 16px; background: var(--md-sys-color-surface-container-high); }
.file-icon-symbol--folder { background: var(--md-sys-color-primary-container); }
.file-icon-symbol .type-icon { --md-icon-size: 44px; }
.file-icon-symbol--folder .type-icon { color: var(--md-sys-color-on-primary-container); }
.file-icon-name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; width: 100%; min-height: 3em; overflow: hidden; overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; }
.file-icon-meta { color: var(--md-sys-color-on-surface-variant); font-size: 11px; line-height: 1.5; }
.file-context-anchor { position: fixed; width: 1px; height: 1px; pointer-events: none; }
.file-context-menu {
  min-width: min(216px, var(--file-menu-available-width, calc(100vw - 16px)));
  max-width: min(320px, var(--file-menu-available-width, calc(100vw - 16px)));
  max-height: var(--file-menu-available-height, calc(100dvh - var(--app-bar-height, 64px) - 16px));
  --md-menu-container-shape: 8px;
  --md-menu-top-space: 4px;
  --md-menu-bottom-space: 4px;
  --md-menu-item-one-line-container-height: 36px;
  --md-menu-item-top-space: 4px;
  --md-menu-item-bottom-space: 4px;
  --md-menu-item-label-text-size: 14px;
  --md-menu-item-label-text-line-height: 20px;
}
.file-context-menu md-divider { margin: 4px 0; }
.file-context-heading { padding: 6px 16px; max-width: 264px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--md-sys-color-on-surface-variant); font-size: 12px; line-height: 1.5; }
.file-context-delete { --md-menu-item-label-text-color: var(--md-sys-color-error); --md-menu-item-leading-icon-color: var(--md-sys-color-error); }
@media (pointer: coarse) {
  .file-context-menu { --md-menu-item-one-line-container-height: 40px; }
}
.file-list-loading { display: flex; align-items: center; justify-content: center; gap: 14px; min-height: 200px; padding: 28px 16px; box-sizing: border-box; }
.file-list-loading md-circular-progress { flex: 0 0 auto; --md-circular-progress-size: 28px; }
.file-list-loading-copy { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.file-list-loading-title { color: var(--md-sys-color-on-surface); font-size: 14px; font-weight: 500; line-height: 1.5; }
.file-list-loading-note { color: var(--md-sys-color-on-surface-variant); font-size: 12px; line-height: 1.6; }
.preview-headline { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.preview-name { font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; overflow-wrap: anywhere; }
.preview-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.file-preview-dialog { --md-dialog-container-width: min(900px, calc(100vw - 32px)); --md-dialog-container-max-width: min(900px, calc(100vw - 32px)); }
.preview-body { width: min(820px, calc(100vw - 88px)); min-width: 0; }
.plain-link { text-decoration: none; }
.fullscreen-layer { position: fixed; inset: 0; z-index: 30; width: 100vw; height: 100dvh; display: flex; flex-direction: column; background: var(--md-sys-color-surface); }
.fullscreen-bar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--md-sys-color-outline-variant); background: var(--md-sys-color-surface-container); }
.fullscreen-name { flex: 1; min-width: 0; font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fullscreen-body { flex: 1; min-height: 0; overflow: auto; padding: 16px; }
.dialog-form { display: flex; flex-direction: column; gap: 16px; min-width: min(420px, calc(100vw - 72px)); }
.dialog-form md-outlined-text-field { width: 100%; }
.quick-dirs { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }
.delete-list { margin: 0; padding-left: 20px; font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--md-sys-color-on-surface-variant); }

.transfer-browser { margin-top: 12px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; overflow: hidden; }
.transfer-browser-header { padding: 8px 12px; border-bottom: 1px solid var(--md-sys-color-outline-variant); background: var(--md-sys-color-surface-container-low); }
.transfer-crumbs { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; font-size: 13px; }
.crumb-sep { color: var(--md-sys-color-on-surface-variant); padding: 0 4px; }
.transfer-browser-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 32px; color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.transfer-browser-list { max-height: 320px; overflow-y: auto; }
.transfer-browser-empty { padding: 24px; text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.transfer-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; cursor: pointer; transition: background 100ms; }
.transfer-item:hover { background: var(--md-sys-color-surface-container-high); }
.transfer-item--selected { background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); }
.transfer-item--up { background: var(--md-sys-color-surface-container-low); }
.transfer-item md-icon:first-child { color: var(--md-sys-color-primary); }
.transfer-item--selected md-icon:first-child { color: var(--md-sys-color-on-primary-container); }
.transfer-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.transfer-item md-icon-button { flex-shrink: 0; }

.extract-options { display: flex; flex-direction: column; gap: 12px; }
.extract-option { position: relative; display: block; padding: 14px; border: 2px solid var(--md-sys-color-outline-variant); border-radius: 8px; cursor: pointer; transition: all 150ms; }
.extract-option:hover { border-color: var(--md-sys-color-outline); background: var(--md-sys-color-surface-container-low); }
.extract-option--selected { border-color: var(--md-sys-color-primary); background: var(--md-sys-color-primary-container); }
.extract-option input[type="radio"] { position: absolute; opacity: 0; pointer-events: none; }
.extract-option-content { display: flex; flex-direction: column; gap: 6px; }
.extract-option-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; color: var(--md-sys-color-on-surface); }
.extract-option--selected .extract-option-title { color: var(--md-sys-color-on-primary-container); }
.extract-option-title md-icon { --md-icon-size: 20px; color: var(--md-sys-color-primary); }
.extract-option--selected .extract-option-title md-icon { color: var(--md-sys-color-on-primary-container); }
.extract-option-desc { font-size: 12px; color: var(--md-sys-color-on-surface-variant); padding-left: 28px; }
.extract-option--selected .extract-option-desc { color: var(--md-sys-color-on-primary-container); }

@media (min-width: 1440px) {
  .file-workspace--with-uploads { grid-template-columns: minmax(0, 1fr) 304px; }
  .file-workspace--with-uploads .data-table { min-width: 0; }
  .file-workspace--with-uploads .data-table th:nth-child(5), .file-workspace--with-uploads .data-table td:nth-child(5) { width: 96px; }
  .file-workspace--with-uploads .desktop-actions { display: none; }
  .file-workspace--with-uploads .mobile-actions { display: flex; }
}

@media (max-width: 1439px) {
  .upload-panel { position: static; }
  .file-workspace--has-uploads .upload-panel { order: -1; }
  .upload-list { max-height: 264px; }
  .upload-empty { flex-direction: row; padding: 16px 0 0; text-align: left; }
  .upload-empty-icon { flex: 0 0 auto; width: 44px; height: 44px; border-radius: 12px; }
}

@media (max-width: 1240px) {
  .data-table { min-width: 0; }
  .data-table th:nth-child(5), .data-table td:nth-child(5) { width: 96px; }
  .desktop-actions { display: none; }
  .mobile-actions { display: flex; }
}

@media (max-width: 720px) {
  .file-workspace > .card { padding: 14px; }
  .file-tools { width: 100%; gap: 6px; }
  .file-search-tools { width: 100%; max-width: none; flex: 1 1 100%; }
  .file-location { align-items: flex-start; gap: 4px; }
  .directory-count { padding-top: 12px; }
  .crumb-name { max-width: 136px; }
  .preview-body { min-width: 0; }
  .col-time { display: none; }
  .data-table .col-check { width: 36px; padding-inline: 4px; }
  .data-table th:nth-child(2), .data-table td:nth-child(2) { width: auto; }
  .data-table th:nth-child(3), .data-table td:nth-child(3) { width: 72px; }
  .data-table th:nth-child(5), .data-table td:nth-child(5) { width: 88px; }
  .name-cell-content { gap: 6px; padding-inline: 6px; }
  .file-icon-grid { grid-template-columns: repeat(auto-fill, minmax(min(116px, 100%), 1fr)); gap: 8px; }
  .icon-view-select-all { padding-inline: 4px; }
  .icon-view-sorting .sort-button { padding-inline: 8px; }
}
</style>
