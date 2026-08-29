<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

useHead({ title: '服务器文件' })

interface InstanceSummary {
  instanceUuid: string
  daemonId: string
  nickname: string
  status: number
  statusLabel: string
  hostIp: string
  remarks: string
}

interface FileEntry {
  name: string
  size: number
  time: string
  mode: number
  kind: string
  editable: boolean
  previewable: boolean
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

type SortField = 'name' | 'size' | 'time'

const { showToast } = useToast()
const access = useAdminAccess()
const canEditPage = computed(() => access.levelForKey('server-files') === 'edit')
const canModifyFiles = computed(() => canEditPage.value && access.featureLevelForKey('server-files-edit') === 'edit')
const canUploadFiles = computed(() => canEditPage.value && access.featureLevelForKey('server-files-upload') === 'edit')
const canDeleteFiles = computed(() => canEditPage.value && access.featureLevelForKey('server-files-delete') === 'edit')
const { apply: applyDialogAnimation } = useDialogAnimation()

const loading = ref(true)
const configured = ref(false)
const instances = ref<InstanceSummary[]>([])
const selectedKey = ref('')

const path = ref('/')
const items = ref<FileEntry[]>([])
const total = ref(0)
const listLoading = ref(false)

const keyword = ref('')
const sortField = ref<SortField>('name')
const sortAsc = ref(true)
// 选中项按名字记，切目录时清空——不同目录同名文件不该串在一起。
const selectedNames = ref<string[]>([])

const previewOpen = ref(false)
const previewFullscreen = ref(false)
const previewTarget = ref<FileEntry | null>(null)
const previewDialog = ref<HTMLElement | null>(null)
const previewRef = ref<{ relayout: () => void } | null>(null)

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
const uploadName = ref('')
const uploadPercent = ref(0)
const dragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const mobileMenuEntry = ref<string | null>(null)
let uploadRequest: XMLHttpRequest | null = null
const UPLOAD_MAX_BYTES = 256 * 1024 * 1024

const instance = computed(() => instances.value.find((item) => instanceKey(item) === selectedKey.value) || null)

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

function instanceKey(item: { daemonId: string; instanceUuid: string }) {
  return `${item.daemonId}:${item.instanceUuid}`
}

function fullPath(name: string) {
  return path.value === '/' ? `/${name}` : `${path.value}/${name}`
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
  void navigateTo('/settings')
}

function requestBase() {
  return { uuid: instance.value?.instanceUuid || '', daemonId: instance.value?.daemonId || '' }
}

async function loadInstances() {
  loading.value = true
  try {
    const result = await $fetch<{ configured: boolean; instances: InstanceSummary[] }>('/api/admin/mcsm/instances')
    configured.value = result.configured
    instances.value = result.instances
    if (!result.instances.some((item) => instanceKey(item) === selectedKey.value)) {
      selectedKey.value = result.instances.length ? instanceKey(result.instances[0]!) : ''
    }
  } catch (error: any) {
    showToast(errorMessage(error, '实例列表加载失败'), 'error')
  } finally {
    loading.value = false
  }
}

async function loadList(next = path.value) {
  if (!instance.value) return
  listLoading.value = true
  try {
    const result = await $fetch<{ path: string; total: number; items: FileEntry[] }>('/api/admin/mcsm/files', {
      query: { ...requestBase(), path: next },
    })
    if (result.path !== path.value) selectedNames.value = []
    path.value = result.path
    items.value = result.items
    total.value = result.total
    // 目录内容变了以后，选中项里已经不存在的要剔掉。
    selectedNames.value = selectedNames.value.filter((name) => result.items.some((item) => item.name === name))
  } catch (error: any) {
    showToast(errorMessage(error, '目录加载失败'), 'error')
  } finally {
    listLoading.value = false
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

function setSort(field: SortField) {
  if (sortField.value === field) sortAsc.value = !sortAsc.value
  else {
    sortField.value = field
    sortAsc.value = true
  }
}

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

function mobileActionId(entryIndex: number) {
  return `mobile-file-actions-${entryIndex}`
}

function toggleMobileMenu(entry: FileEntry) {
  mobileMenuEntry.value = mobileMenuEntry.value === entry.name ? null : entry.name
}

function closeMobileMenu(entry: FileEntry) {
  if (mobileMenuEntry.value === entry.name) mobileMenuEntry.value = null
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
  if (!canModifyFiles.value || createBusy.value || !createName.value.trim()) return
  createBusy.value = true
  try {
    await $fetch('/api/admin/mcsm/files/create', {
      method: 'POST',
      body: { ...requestBase(), path: path.value, name: createName.value.trim(), kind: createKind.value },
    })
    showToast(createKind.value === 'directory' ? '目录已创建' : '文件已创建')
    createOpen.value = false
    await loadList()
  } catch (error: any) {
    showToast(errorMessage(error, '创建失败'), 'error')
  } finally {
    createBusy.value = false
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
  if (!target || !canModifyFiles.value || renameBusy.value) return
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
    showToast('已重命名')
    renameTarget.value = null
    await loadList()
  } catch (error: any) {
    showToast(errorMessage(error, '重命名失败'), 'error')
  } finally {
    renameBusy.value = false
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
  transferBrowseLoading.value = true
  try {
    const result = await $fetch<FileListResult>('/api/admin/mcsm/files', {
      query: { ...requestBase(), path: targetPath },
    })
    transferBrowsePath.value = targetPath
    // 只显示目录
    transferBrowseList.value = result.items.filter((item) => item.kind === 'directory')
  } catch (error: any) {
    showToast(errorMessage(error, '加载目录失败'), 'error')
  } finally {
    transferBrowseLoading.value = false
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
  if (!mode || !canModifyFiles.value || transferBusy.value) return
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
    showToast(`${mode === 'copy' ? '已复制' : '已移动'} ${result.count} 项`)
    transferMode.value = null
    selectedNames.value = []
    await loadList()
  } catch (error: any) {
    showToast(errorMessage(error, mode === 'copy' ? '复制失败' : '移动失败'), 'error')
  } finally {
    transferBusy.value = false
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
    const entry = selectedEntries.value[0]!
    const downloadUrl = `/api/admin/mcsm/files/raw?uuid=${route.query.uuid}&daemonId=${route.query.daemonId}&path=${encodeURIComponent(fullPath(entry.name))}`
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = entry.name
    a.click()
    return
  }

  // 多文件：提示先压缩再下载
  showToast('多文件下载：请先使用"压缩"功能打包，然后下载压缩包', 'info')
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
  if (!canModifyFiles.value || compressBusy.value || !compressName.value.trim()) return
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
    showToast('压缩完成')
    compressOpen.value = false
    selectedNames.value = []
    await loadList()
  } catch (error: any) {
    showToast(errorMessage(error, '压缩失败，运行中的服务器会占用部分文件'), 'error')
  } finally {
    compressBusy.value = false
  }
}

async function confirmExtract() {
  const target = extractTarget.value
  if (!target || !canModifyFiles.value || extractBusy.value) return

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
    showToast('解压完成')
    extractTarget.value = null
    await loadList()
  } catch (error: any) {
    showToast(errorMessage(error, '解压失败'), 'error')
  } finally {
    extractBusy.value = false
  }
}

function openExtract(entry: FileEntry) {
  if (!canModifyFiles.value) return
  extractTarget.value = entry
  extractMode.value = 'folder'
  // 默认文件夹名为去掉 .zip 扩展名
  const baseName = entry.name.replace(/\.zip$/i, '')
  extractFolderName.value = baseName
  applyDialogAnimation(extractDialog.value)
}

async function confirmDelete() {
  if (!canDeleteFiles.value || deleteBusy.value || !selectedEntries.value.length) return
  deleteBusy.value = true
  try {
    const result = await $fetch<{ count: number }>('/api/admin/mcsm/files/delete', {
      method: 'POST',
      body: { ...requestBase(), paths: selectedEntries.value.map((entry) => fullPath(entry.name)) },
    })
    showToast(`已删除 ${result.count} 项`)
    deleteOpen.value = false
    selectedNames.value = []
    await loadList()
  } catch (error: any) {
    showToast(errorMessage(error, '删除失败'), 'error')
  } finally {
    deleteBusy.value = false
  }
}

// ===== 上传 =====

function pickFiles() {
  if (!canUploadFiles.value) return
  fileInput.value?.click()
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
  const files = [...(event.dataTransfer?.files || [])]
  if (files.length) void uploadFiles(files)
}

/**
 * 逐个分块上传。用 XHR 而不是 fetch，因为只有 XHR 能给上传进度；
 * 每个请求体保持很小，服务端在全部分块收到后再拼成 multipart 转发给守护进程。
 */
async function uploadFiles(files: File[]) {
  if (!canUploadFiles.value || !files.length || uploading.value) return
  const oversized = files.find((file) => file.size > UPLOAD_MAX_BYTES)
  if (oversized) {
    showToast(`${oversized.name} 超过 256 MiB，无法上传`, 'error')
    return
  }
  uploading.value = true
  try {
    for (const file of files) {
      uploadName.value = file.name
      uploadPercent.value = 0
      await uploadOne(file)
      showToast(`${file.name} 已上传`)
    }
    await loadList()
  } catch (error: any) {
    showToast(error?.message || '上传失败', 'error')
  } finally {
    uploading.value = false
    uploadName.value = ''
    uploadPercent.value = 0
    uploadRequest = null
  }
}

async function uploadOne(file: File) {
  const chunkSize = 128 * 1024
  const uploadId = createUploadId()
  let offset = 0

  while (offset < file.size || (file.size === 0 && offset === 0)) {
    const end = Math.min(file.size, offset + chunkSize)
    const chunk = file.slice(offset, end)
    const final = end === file.size
    await uploadChunk(file, uploadId, offset, chunk, final)
    offset = end
    uploadPercent.value = file.size === 0 ? 100 : Math.round((offset / file.size) * 100)
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

function uploadChunk(file: File, uploadId: string, offset: number, chunk: Blob, final: boolean) {
  return new Promise<void>((resolve, reject) => {
    const params = new URLSearchParams({
      ...requestBase(),
      path: path.value,
      name: file.name,
      uploadId,
      offset: String(offset),
      total: String(file.size),
      final: final ? '1' : '0',
    })
    const request = new XMLHttpRequest()
    uploadRequest = request
    request.open('PUT', `/api/admin/mcsm/files/upload-chunk?${params.toString()}`)
    request.setRequestHeader('Content-Type', 'application/octet-stream')
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && file.size > 0) {
        uploadPercent.value = Math.round(((offset + event.loaded) / file.size) * 100)
      }
    })
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        resolve()
        return
      }
      let message = `上传失败（${request.status}）`
      try {
        const payload = JSON.parse(request.responseText)
        if (payload?.statusMessage) message = payload.statusMessage
      } catch {
        // 非 JSON 响应就用默认文案。
      }
      reject(new Error(message))
    })
    request.addEventListener('error', () => reject(new Error('上传过程中网络中断')))
    request.addEventListener('abort', () => reject(new Error('上传已取消')))
    request.send(chunk)
  })
}

function cancelUpload() {
  uploadRequest?.abort()
}

watch(selectedKey, async (key) => {
  items.value = []
  selectedNames.value = []
  path.value = '/'
  if (key) await loadList('/')
})

onMounted(async () => {
  window.addEventListener('keydown', onFullscreenKeydown)
  window.addEventListener('keydown', onSaveShortcut)
  await loadInstances()
  if (selectedKey.value) await loadList('/')
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onFullscreenKeydown)
  window.removeEventListener('keydown', onSaveShortcut)
  uploadRequest?.abort()
})
</script>

<template>
  <div class="page page--wide">
    <div class="page-heading">
      <h1 class="page-title">服务器文件</h1>
      <md-icon-button aria-label="刷新" title="刷新" :disabled="listLoading" @click="loadList()">
        <md-icon>refresh</md-icon>
      </md-icon-button>
    </div>

    <p v-if="loading" class="empty">正在读取面板信息…</p>

    <section v-else-if="!configured" class="card">
      <h2 class="card-title">尚未连接 MCSM 面板</h2>
      <p class="card-note">请先到「站点设置」页填写 MCSManager 的面板地址与 ApiKey。</p>
      <div class="form-actions">
        <md-filled-button @click="goToSettings">
          <md-icon slot="icon">settings</md-icon>
          去站点设置
        </md-filled-button>
      </div>
    </section>

    <template v-else>
      <section class="card">
        <md-outlined-select
          v-if="instances.length"
          class="instance-select"
          label="实例"
          :value="selectedKey"
          @change="selectedKey = ($event.target as HTMLSelectElement).value"
        >
          <md-select-option
            v-for="item in instances"
            :key="instanceKey(item)"
            :value="instanceKey(item)"
            :selected="instanceKey(item) === selectedKey"
          >
            <div slot="headline">{{ item.nickname || item.instanceUuid }}</div>
            <div slot="supporting-text">{{ item.statusLabel }} · {{ item.hostIp || item.remarks }}</div>
          </md-select-option>
        </md-outlined-select>
        <p v-else class="empty">当前 ApiKey 名下没有任何实例。</p>
      </section>

      <section
        v-if="instance"
        class="card browser"
        :class="{ 'browser--drag': dragOver }"
        @dragover.prevent="dragOver = canUploadFiles"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
      >
        <div class="toolbar">
          <div class="crumbs">
            <md-icon-button
              v-if="path !== '/'"
              aria-label="返回上一级"
              title="返回上一级"
              @click="loadList(parentPath)"
            >
              <md-icon>arrow_upward</md-icon>
            </md-icon-button>
            <md-text-button @click="loadList('/')">
              <md-icon slot="icon">home</md-icon>
              根目录
            </md-text-button>
            <template v-for="crumb in crumbs" :key="crumb.path">
              <span class="crumb-sep">/</span>
              <md-text-button @click="loadList(crumb.path)">{{ crumb.name }}</md-text-button>
            </template>
          </div>

          <div class="tools">
            <md-outlined-text-field
              class="search"
              label="筛选当前目录"
              :value="keyword"
              @input="keyword = ($event.target as HTMLInputElement).value"
            >
              <md-icon slot="leading-icon">search</md-icon>
            </md-outlined-text-field>
            <md-icon-button aria-label="刷新" title="刷新" @click="loadList(path)">
              <md-icon>refresh</md-icon>
            </md-icon-button>
            <md-filled-button v-if="canUploadFiles" :disabled="uploading" @click="pickFiles">
              <md-icon slot="icon">upload</md-icon>
              上传
            </md-filled-button>
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
        </div>

        <input
          ref="fileInput"
          type="file"
          multiple
          class="hidden-input"
          @change="onFilePicked"
        />

        <p v-if="canModifyFiles" class="card-note">运行中被占用的文件无法压缩。</p>
        <p v-if="canDeleteFiles" class="card-note">删除没有回收站。</p>

        <div v-if="uploading" class="upload-bar">
          <span class="upload-name">正在上传 {{ uploadName }}</span>
          <div class="progress-track"><div class="progress-fill" :style="{ width: uploadPercent + '%' }"></div></div>
          <span class="upload-percent">{{ uploadPercent }}%</span>
          <md-text-button @click="cancelUpload">取消</md-text-button>
        </div>

        <div v-if="selectedEntries.length" class="bulk-bar">
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

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th class="col-check">
                  <md-checkbox
                    :checked="allVisibleSelected"
                    :indeterminate="selectedEntries.length > 0 && !allVisibleSelected"
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
                v-for="(entry, entryIndex) in visibleItems"
                :key="entry.name"
                :class="{ 'row--selected': selectedNames.includes(entry.name) }"
              >
                <td class="col-check">
                  <md-checkbox
                    :checked="selectedNames.includes(entry.name)"
                    @change="toggleSelect(entry.name)"
                  ></md-checkbox>
                </td>
                <td class="name-cell">
                  <div class="name-cell-content">
                    <md-icon class="type-icon" :class="`type-icon--${entry.kind}`">
                      {{ KIND_ICONS[entry.kind] || 'draft' }}
                    </md-icon>
                    <button type="button" class="name-link" @click="openEntry(entry)">{{ entry.name }}</button>
                  </div>
                </td>
                <td class="col-size">{{ entry.kind === 'directory' ? '—' : formatBytes(entry.size) }}</td>
                <td class="col-time">{{ formatTime(entry.time) }}</td>
                <td class="cell-actions">
                  <div class="cell-actions-content desktop-actions">
                    <div class="actions-left">
                      <md-icon-button
                        v-if="canModifyFiles && entry.kind === 'archive' && entry.name.toLowerCase().endsWith('.zip')"
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
                  <div v-if="entry.kind !== 'directory' || canModifyFiles || canDeleteFiles" class="mobile-actions">
                    <md-icon-button
                      :id="mobileActionId(entryIndex)"
                      aria-label="更多操作"
                      title="更多操作"
                      @click="toggleMobileMenu(entry)"
                    >
                      <md-icon>more_vert</md-icon>
                    </md-icon-button>
                    <md-menu
                      :anchor="mobileActionId(entryIndex)"
                      positioning="fixed"
                      anchor-corner="end-end"
                      menu-corner="start-end"
                      :open="mobileMenuEntry === entry.name"
                      @closed="closeMobileMenu(entry)"
                    >
                      <md-menu-item
                        v-if="canModifyFiles && entry.kind === 'archive' && entry.name.toLowerCase().endsWith('.zip')"
                        @click="openExtract(entry)"
                      >
                        <md-icon slot="start">unarchive</md-icon>
                        <span slot="headline">解压</span>
                      </md-menu-item>
                      <md-menu-item v-if="entry.kind !== 'directory'" @click="openPreview(entry)">
                        <md-icon slot="start">{{ entry.editable && canModifyFiles ? 'edit' : 'visibility' }}</md-icon>
                        <span slot="headline">{{ entry.editable && canModifyFiles ? '编辑' : '预览' }}</span>
                      </md-menu-item>
                      <md-menu-item v-if="entry.kind !== 'directory'" type="link" :href="downloadUrl(entry)">
                        <md-icon slot="start">download</md-icon>
                        <span slot="headline">下载</span>
                      </md-menu-item>
                      <md-menu-item v-if="canModifyFiles" @click="copySingle(entry)">
                        <md-icon slot="start">content_copy</md-icon>
                        <span slot="headline">复制到...</span>
                      </md-menu-item>
                      <md-menu-item v-if="canModifyFiles" @click="moveSingle(entry)">
                        <md-icon slot="start">drive_file_move</md-icon>
                        <span slot="headline">移动到...</span>
                      </md-menu-item>
                      <md-menu-item v-if="canModifyFiles" @click="openRename(entry)">
                        <md-icon slot="start">drive_file_rename_outline</md-icon>
                        <span slot="headline">重命名</span>
                      </md-menu-item>
                      <md-menu-item v-if="canDeleteFiles" @click="deleteSingle(entry)">
                        <md-icon slot="start">delete</md-icon>
                        <span slot="headline">删除</span>
                      </md-menu-item>
                    </md-menu>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="listLoading" class="empty">加载中…</p>
          <p v-else-if="!items.length" class="empty">这个目录是空的</p>
          <p v-else-if="!visibleItems.length" class="empty">没有匹配「{{ keyword }}」的条目</p>
          <p v-else class="count-note">共 {{ total }} 项，显示 {{ visibleItems.length }} 项</p>
        </div>
      </section>
    </template>

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
      <div class="fullscreen-body">
        <FilePreview
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

          <div v-else class="transfer-browser-list">
            <div
              v-if="transferBrowsePath !== '/'"
              class="transfer-item transfer-item--up"
              @click="loadTransferBrowseList(transferBrowsePath.split('/').slice(0, -1).join('/') || '/')"
            >
              <md-icon>arrow_upward</md-icon>
              <span>返回上一级</span>
            </div>

            <div
              v-if="!transferBrowseList.length"
              class="transfer-browser-empty"
            >
              此目录下没有子目录
            </div>

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
        <p class="card-note">大目录压缩可能先超时；任务仍会在面板侧继续，稍后刷新查看。</p>
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
      <div slot="headline">解压 zip 文件</div>
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
.page-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.card + .card { margin-top: 20px; }
.card-note { margin: 8px 0 0; font-size: 13px; line-height: 1.7; color: var(--md-sys-color-on-surface-variant); }
.card-note code { padding: 1px 5px; border-radius: 4px; background: var(--md-sys-color-surface); font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.instance-select { min-width: 280px; width: min(100%, 420px); }
.form-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 14px; }
.browser { transition: outline-color 160ms ease; outline: 2px dashed transparent; outline-offset: -6px; }
.browser--drag { outline-color: var(--md-sys-color-primary); }
.toolbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.crumbs { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; min-width: 0; }
.crumb-sep { color: var(--md-sys-color-on-surface-variant); }
.tools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.search { min-width: 200px; }
.hidden-input { display: none; }
.upload-bar { display: flex; align-items: center; gap: 12px; margin-top: 14px; padding: 10px 12px; border-radius: 8px; background: var(--md-sys-color-surface-variant); font-size: 13px; flex-wrap: wrap; }
.upload-name { color: var(--md-sys-color-on-surface-variant); overflow-wrap: anywhere; }
.progress-track { flex: 1 1 160px; height: 6px; border-radius: 999px; background: var(--md-sys-color-outline-variant); overflow: hidden; }
.progress-fill { height: 100%; background: var(--md-sys-color-primary); transition: width 120ms linear; }
.upload-percent { font-variant-numeric: tabular-nums; }
.bulk-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 14px; padding: 8px 14px; border-radius: 8px; background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); font-size: 13px; }
.bulk-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.danger { color: var(--md-sys-color-error); }
.table-wrap { overflow-x: auto; margin-top: 12px; }
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
.mobile-actions md-menu { --md-menu-container-shape: 8px; }
.actions-left { display: flex; align-items: center; flex-shrink: 0; }
.actions-right { display: flex; align-items: center; flex-shrink: 0; margin-left: auto; }
.count-note { padding: 12px 0 0; margin: 0; font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.empty { padding: 20px 0; color: var(--md-sys-color-on-surface-variant); font-size: 14px; }
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

@media (max-width: 720px) {
  .page-heading { align-items: stretch; flex-direction: column; }
  .instance-select { width: 100%; min-width: 0; }
  .tools { width: 100%; }
  .search { width: 100%; min-width: 0; flex: 1 1 100%; }
  .preview-body { min-width: 0; }
  .col-time { display: none; }
  .data-table { min-width: 640px; }
  .data-table th:nth-child(2), .data-table td:nth-child(2) { width: auto; }
  .data-table th:nth-child(3), .data-table td:nth-child(3) { width: 76px; }
  .data-table th:nth-child(5), .data-table td:nth-child(5) { width: 64px; }
  .desktop-actions { display: none; }
  .mobile-actions { display: flex; }
}
</style>
