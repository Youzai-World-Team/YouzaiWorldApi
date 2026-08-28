<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { marked } from 'marked'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'

/**
 * 文件预览渲染器。
 * <p>
 * 按服务端判定的 kind 分派：图片 / 视频 / 音频走同源代理直接内联，文本走 Monaco，
 * 其余类型只给下载入口。之所以能内联——代理接口把守护进程的字节同源转发了一遍，
 * 否则页面 CSP 的 {@code img-src 'self'} 和混合内容拦截都过不去。
 * </p>
 * <p>
 * 弹窗和独立预览页共用这个组件，区别只在外壳；全屏由调用方对容器发起。
 * </p>
 */
const props = withDefaults(defineProps<{
  uuid: string
  daemonId: string
  path: string
  kind: string
  size?: number
  canEdit?: boolean
  /** 编辑器高度，独立页里给得更高。 */
  editorHeight?: string
}>(), {
  size: 0,
  canEdit: false,
  editorHeight: '420px',
})

const emit = defineEmits<{ saved: [] }>()

// 扩展名 → Monaco 语言。properties/cfg/ini 都按 ini 高亮，效果比纯文本好得多。
const LANGUAGE_BY_EXT: Record<string, string> = {
  json: 'json', json5: 'json', jsonc: 'json', mcmeta: 'json',
  yml: 'yaml', yaml: 'yaml',
  properties: 'ini', cfg: 'ini', conf: 'ini', ini: 'ini', lang: 'ini', env: 'ini',
  toml: 'ini',
  xml: 'xml',
  md: 'markdown',
  sh: 'shell', bat: 'bat', cmd: 'bat', ps1: 'powershell',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript',
  css: 'css', sql: 'sql', csv: 'plaintext', tsv: 'plaintext',
}

const { showToast } = useToast()

const text = ref('')
const original = ref('')
const truncated = ref(false)
const loading = ref(false)
const saving = ref(false)
const mediaError = ref(false)
const editorRef = ref<{ layout: () => void } | null>(null)

// 文档预览状态
const docHtml = ref('')
const docLoading = ref(false)
const docError = ref('')

// 压缩包浏览状态
const zipFiles = ref<string[]>([])
const zipCurrentPath = ref('/')
const zipEntries = ref<Array<{ name: string; isDir: boolean; fullPath: string }>>([])

const fileName = computed(() => props.path.split('/').filter(Boolean).pop() || props.path)
const extension = computed(() => {
  const index = fileName.value.lastIndexOf('.')
  return index > 0 ? fileName.value.slice(index + 1).toLowerCase() : ''
})
const language = computed(() => LANGUAGE_BY_EXT[extension.value] || 'plaintext')
const dirty = computed(() => text.value !== original.value)
const isText = computed(() => props.kind === 'text' || props.kind === 'markdown')
const isMedia = computed(() => ['image', 'video', 'audio'].includes(props.kind))
const isDocument = computed(() => props.kind === 'document')
const isBinary = computed(() => props.kind === 'binary')

// 二进制文件尝试以文本方式打开
const binaryAsText = ref(false)
const binaryTextLoading = ref(false)
const binaryEditorRef = ref<any>(null)

// 从文件名推测语言（用于二进制文件文本预览）
const guessLanguageFromPath = computed(() => {
  if (!props.path) return 'plaintext'
  const name = props.path.split('/').pop() || ''
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : ''

  // 常见扩展名映射
  const langMap: Record<string, string> = {
    bat: 'bat', cmd: 'bat', sh: 'shell', bash: 'shell',
    ps1: 'powershell', py: 'python', js: 'javascript',
    ts: 'typescript', json: 'json', xml: 'xml', html: 'html',
    css: 'css', yml: 'yaml', yaml: 'yaml', toml: 'toml',
    md: 'markdown', txt: 'plaintext', log: 'plaintext',
  }

  return langMap[ext || ''] || 'plaintext'
})

function rawUrl(download = false) {
  const params = new URLSearchParams({ uuid: props.uuid, daemonId: props.daemonId, path: props.path })
  if (download) params.set('download', '1')
  return `/api/admin/mcsm/files/raw?${params.toString()}`
}

const previewUrl = computed(() => rawUrl(false))
const downloadUrl = computed(() => rawUrl(true))

function formatBytes(value: number) {
  if (!value) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`
}

async function loadText() {
  loading.value = true
  mediaError.value = false
  try {
    const result = await $fetch<{ path: string; text: string; truncated: boolean }>('/api/admin/mcsm/file', {
      query: { uuid: props.uuid, daemonId: props.daemonId, path: props.path },
    })
    text.value = result.text
    original.value = result.text
    truncated.value = result.truncated
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '文件读取失败', 'error')
  } finally {
    loading.value = false
  }
}

async function loadBinaryAsText() {
  binaryTextLoading.value = true
  try {
    const url = `/api/admin/mcsm/files/raw?uuid=${props.uuid}&daemonId=${props.daemonId}&path=${encodeURIComponent(props.path)}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    // 调试：检查响应头
    console.log('Content-Type:', response.headers.get('content-type'))
    console.log('Content-Encoding:', response.headers.get('content-encoding'))

    const blob = await response.blob()
    console.log('Blob type:', blob.type, 'size:', blob.size)

    const rawText = await blob.text()

    // 调试：检查每行开头
    const lines = rawText.split('\n').slice(0, 5)
    lines.forEach((line, i) => {
      console.log(`Line ${i}:`, JSON.stringify(line.slice(0, 30)))
    })

    // 去除各种不可见字符和 BOM
    let cleanText = rawText
      .replace(/^﻿/, '') // UTF-8 BOM
      .replace(/^￾/, '') // UTF-16 BE BOM
      .replace(/^[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/g, '') // 控制字符（保留 \t \n \r）

    // 统一换行符
    cleanText = cleanText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    text.value = cleanText.slice(0, 512 * 1024) // 限制 512KB
    original.value = text.value
    truncated.value = rawText.length > 512 * 1024
    binaryAsText.value = true

    // 等待 DOM 更新后手动触发 Monaco 重新布局
    await nextTick()
    binaryEditorRef.value?.layout()
  } catch (error: any) {
    showToast(error?.message || '文件读取失败', 'error')
  } finally {
    binaryTextLoading.value = false
  }
}

async function loadDocument() {
  docLoading.value = true
  docError.value = ''
  docHtml.value = ''
  try {
    const url = `/api/admin/mcsm/files/raw?uuid=${props.uuid}&daemonId=${props.daemonId}&path=${encodeURIComponent(props.path)}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const ext = extension.value
    if (ext === 'pdf') {
      // PDF 直接用 iframe 展示
      docHtml.value = `<iframe src="${url}" style="width:100%;height:min(70vh,800px);border:0"></iframe>`
      return
    }

    const blob = await response.blob()

    if (ext === 'docx') {
      const arrayBuffer = await blob.arrayBuffer()
      const result = await mammoth.convertToHtml({ arrayBuffer })
      docHtml.value = result.value
      if (result.messages.length) console.warn('mammoth warnings:', result.messages)
    } else if (ext === 'xlsx') {
      const arrayBuffer = await blob.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer)
      let html = '<div class="xlsx-preview">'
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        if (!sheet) continue
        html += `<h3>${sheetName}</h3>`
        html += XLSX.utils.sheet_to_html(sheet, { editable: false })
      }
      html += '</div>'
      docHtml.value = html
    } else if (ext === 'zip' || ext === 'jar') {
      const arrayBuffer = await blob.arrayBuffer()
      const zip = await JSZip.loadAsync(arrayBuffer)
      const files: string[] = []
      zip.forEach((path, file) => {
        if (!file.dir) files.push(path)
      })
      zipFiles.value = files.sort()
      zipCurrentPath.value = '/'
      updateZipEntries()
    } else {
      docError.value = '不支持的文档格式'
    }
  } catch (error: any) {
    docError.value = error?.message || '文档加载失败'
  } finally {
    docLoading.value = false
  }
}

function updateZipEntries() {
  // zipCurrentPath 是 '/' 或 '/dir/subdir'，需要转换为空字符串或 'dir/subdir'
  const currentDir = zipCurrentPath.value === '/' ? '' : zipCurrentPath.value.slice(1)
  const prefix = currentDir ? currentDir + '/' : ''
  const seen = new Set<string>()
  const entries: Array<{ name: string; isDir: boolean; fullPath: string }> = []

  for (const path of zipFiles.value) {
    if (!path.startsWith(prefix)) continue
    const relative = path.slice(prefix.length)
    if (!relative) continue

    const firstSlash = relative.indexOf('/')
    if (firstSlash === -1) {
      // 当前目录下的文件
      entries.push({ name: relative, isDir: false, fullPath: path })
    } else {
      // 子目录
      const dirName = relative.slice(0, firstSlash)
      if (!seen.has(dirName)) {
        seen.add(dirName)
        entries.push({ name: dirName, isDir: true, fullPath: currentDir ? currentDir + '/' + dirName : dirName })
      }
    }
  }

  // 目录在前，按名称排序
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  zipEntries.value = entries
}

function navigateZip(entry: { name: string; isDir: boolean; fullPath: string }) {
  if (entry.isDir) {
    zipCurrentPath.value = '/' + entry.fullPath
    updateZipEntries()
  }
}

function zipGoUp() {
  if (zipCurrentPath.value === '/') return
  const parts = zipCurrentPath.value.slice(1).split('/')
  parts.pop()
  zipCurrentPath.value = parts.length ? '/' + parts.join('/') : '/'
  updateZipEntries()
}

async function save() {
  if (!props.canEdit || saving.value || !dirty.value || truncated.value) return
  saving.value = true
  try {
    await $fetch('/api/admin/mcsm/file', {
      method: 'PUT',
      body: { uuid: props.uuid, daemonId: props.daemonId, path: props.path, text: text.value },
    })
    original.value = text.value
    showToast(`${fileName.value} 已保存`)
    emit('saved')
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

function revert() {
  text.value = original.value
}

/** 供父组件在容器尺寸变化后（进出全屏）触发编辑器重排。 */
function relayout() {
  editorRef.value?.layout()
}
defineExpose({ relayout, dirty, save })

watch(() => [props.path, props.kind], () => {
  text.value = ''
  original.value = ''
  truncated.value = false
  mediaError.value = false
  docHtml.value = ''
  docError.value = ''
  zipFiles.value = []
  zipCurrentPath.value = '/'
  zipEntries.value = []
  binaryAsText.value = false
  binaryTextLoading.value = false
  if (isText.value) void loadText()
  else if (isDocument.value || props.kind === 'archive') void loadDocument()
}, { immediate: true })
</script>

<template>
  <div class="preview">
    <p v-if="truncated" class="notice">
      文件超出可编辑上限，只读到了前一段内容。为避免截断后保存丢数据，已禁用保存。
    </p>

    <template v-if="isText">
      <p v-if="loading" class="empty">读取中…</p>
      <template v-else>
        <CodeEditor
          v-if="kind !== 'markdown' || canEdit"
          ref="editorRef"
          v-model="text"
          :language="language"
          :readonly="!canEdit || truncated"
          :height="editorHeight"
        />
        <div v-if="kind === 'markdown' && !canEdit" class="markdown-preview" v-html="marked.parse(text)"></div>
        <div class="text-bar">
          <span class="meta">
            {{ language }} · {{ text.length }} 个字符{{ dirty ? ' · 有未保存的修改' : '' }}
          </span>
          <div v-if="canEdit" class="text-actions">
            <md-outlined-button :disabled="saving || !dirty" @click="revert">撤销修改</md-outlined-button>
            <md-filled-button :disabled="saving || !dirty || truncated" @click="save">
              {{ saving ? '保存中…' : '保存' }}
            </md-filled-button>
          </div>
        </div>
      </template>
    </template>

    <template v-else-if="isMedia">
      <p v-if="mediaError" class="notice">
        无法加载这个文件，可能是格式不受浏览器支持或文件已损坏。可以改用下载。
      </p>
      <div v-else class="media-stage">
        <img
          v-if="kind === 'image'"
          class="media-image"
          :src="previewUrl"
          :alt="fileName"
          @error="mediaError = true"
        />
        <video
          v-else-if="kind === 'video'"
          class="media-video"
          :src="previewUrl"
          controls
          preload="metadata"
          @error="mediaError = true"
        ></video>
        <audio
          v-else
          class="media-audio"
          :src="previewUrl"
          controls
          preload="metadata"
          @error="mediaError = true"
        ></audio>
      </div>
      <p v-if="kind !== 'image'" class="hint">
        音视频仅支持顺序播放，拖动进度条可能无效。
      </p>
    </template>

    <template v-else-if="isDocument || kind === 'archive'">
      <p v-if="docLoading" class="empty">加载中…</p>
      <p v-else-if="docError" class="notice">{{ docError }}</p>
      <template v-else-if="kind === 'archive' && zipFiles.length > 0">
        <div class="zip-browser">
          <div class="zip-toolbar">
            <div class="zip-crumbs">
              <button class="zip-crumb-btn" @click="zipCurrentPath = '/'; updateZipEntries()">
                <md-icon>home</md-icon>
                根目录
              </button>
              <template v-for="(segment, index) in zipCurrentPath.slice(1).split('/').filter(Boolean)" :key="index">
                <span class="zip-crumb-sep">/</span>
                <button
                  class="zip-crumb-btn"
                  @click="zipCurrentPath = '/' + zipCurrentPath.slice(1).split('/').filter(Boolean).slice(0, index + 1).join('/'); updateZipEntries()"
                >
                  {{ segment }}
                </button>
              </template>
            </div>
            <span class="zip-meta">共 {{ zipFiles.length }} 个文件</span>
          </div>
          <div class="zip-table-wrap">
            <table class="zip-table">
              <tbody>
                <tr v-if="zipCurrentPath !== '/'" class="zip-row-up">
                  <td colspan="2">
                    <button class="zip-up-btn" @click="zipGoUp">
                      <md-icon>arrow_upward</md-icon>
                      返回上一级
                    </button>
                  </td>
                </tr>
                <tr
                  v-for="entry in zipEntries"
                  :key="entry.fullPath"
                  class="zip-row"
                  :class="{ 'zip-row--dir': entry.isDir }"
                  @click="navigateZip(entry)"
                >
                  <td class="zip-name-cell">
                    <div class="zip-name-content">
                      <md-icon class="zip-type-icon" :class="{ 'zip-type-icon--dir': entry.isDir }">
                        {{ entry.isDir ? 'folder' : 'description' }}
                      </md-icon>
                      <span class="zip-name">{{ entry.name }}</span>
                    </div>
                  </td>
                  <td class="zip-actions">
                    <md-icon v-if="entry.isDir">chevron_right</md-icon>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="!zipEntries.length" class="empty">这个目录是空的</p>
          </div>
        </div>
      </template>
      <div v-else class="document-preview" v-html="docHtml"></div>
    </template>

    <div v-else class="fallback">
      <template v-if="!binaryAsText">
        <md-icon class="fallback-icon">{{ kind === 'archive' ? 'folder_zip' : 'draft' }}</md-icon>
        <p>这个类型不支持在页面里预览。</p>
        <p class="meta">{{ fileName }} · {{ formatBytes(size) }}</p>
        <div class="fallback-actions">
          <a class="plain-link" :href="downloadUrl">
            <md-filled-button>
              <md-icon slot="icon">download</md-icon>
              下载文件
            </md-filled-button>
          </a>
          <md-outlined-button v-if="kind === 'binary'" :disabled="binaryTextLoading" @click="loadBinaryAsText">
            <md-icon slot="icon">description</md-icon>
            {{ binaryTextLoading ? '加载中…' : '尝试以文本方式打开' }}
          </md-outlined-button>
        </div>
      </template>
      <template v-else>
        <p class="notice">
          已尝试以文本方式打开，内容可能包含乱码或不可读字符。这不是文本文件，建议下载后使用专用工具打开。
        </p>
        <CodeEditor
          ref="binaryEditorRef"
          v-model="text"
          :language="guessLanguageFromPath"
          :readonly="true"
          :height="editorHeight"
        />
        <div class="text-bar">
          <span class="meta">{{ guessLanguageFromPath }} · {{ text.length }} 个字符{{ truncated ? '（已截断）' : '' }}</span>
          <md-outlined-button @click="binaryAsText = false">返回</md-outlined-button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.preview { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.notice { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); font-size: 13px; }
.hint { margin: 0; font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.empty { padding: 24px 0; text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 14px; }
.text-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.meta { font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.text-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.media-stage { display: flex; align-items: center; justify-content: center; min-height: 200px; padding: 12px; border-radius: 8px; background: var(--md-sys-color-surface-variant); overflow: auto; }
.media-image { max-width: 100%; max-height: min(68vh, 720px); object-fit: contain; image-rendering: pixelated; }
.media-video { max-width: 100%; max-height: min(68vh, 720px); }
.media-audio { width: min(100%, 520px); }
.fallback { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 32px 16px; text-align: center; }
.fallback p { margin: 0; }
.fallback-icon { --md-icon-size: 48px; color: var(--md-sys-color-on-surface-variant); }
.fallback-actions { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 6px; }
.plain-link { text-decoration: none; }
.markdown-preview { padding: 16px; border-radius: 8px; border: 1px solid var(--md-sys-color-outline-variant); background: var(--md-sys-color-surface-container-lowest); line-height: 1.7; overflow: auto; max-height: min(70vh, 800px); }
.markdown-preview h1, .markdown-preview h2, .markdown-preview h3 { margin: 1.2em 0 0.6em; }
.markdown-preview h1:first-child, .markdown-preview h2:first-child, .markdown-preview h3:first-child { margin-top: 0; }
.markdown-preview p { margin: 0.8em 0; }
.markdown-preview code { padding: 2px 6px; border-radius: 4px; background: var(--md-sys-color-surface); font-family: 'Roboto Mono', monospace; font-size: 0.9em; }
.markdown-preview pre { padding: 12px; border-radius: 8px; background: var(--md-sys-color-surface); overflow-x: auto; }
.markdown-preview pre code { padding: 0; background: none; }
.markdown-preview a { color: var(--md-sys-color-primary); }
.markdown-preview ul, .markdown-preview ol { padding-left: 24px; }
.markdown-preview table { border-collapse: collapse; width: 100%; margin: 1em 0; }
.markdown-preview th, .markdown-preview td { padding: 8px 12px; border: 1px solid var(--md-sys-color-outline-variant); text-align: left; }
.markdown-preview th { background: var(--md-sys-color-surface-container); font-weight: 600; }
.document-preview { padding: 16px; border-radius: 8px; border: 1px solid var(--md-sys-color-outline-variant); background: var(--md-sys-color-surface-container-lowest); overflow: auto; max-height: min(70vh, 800px); }
.document-preview h3 { margin: 1.2em 0 0.6em; font-size: 14px; color: var(--md-sys-color-primary); }
.document-preview h3:first-child { margin-top: 0; }
.document-preview table { border-collapse: collapse; font-size: 12px; width: auto; margin: 0.8em 0; }
.document-preview th, .document-preview td { padding: 6px 10px; border: 1px solid var(--md-sys-color-outline-variant); }
.document-preview th { background: var(--md-sys-color-surface-container); font-weight: 600; }
.zip-browser { border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; overflow: hidden; }
.zip-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: var(--md-sys-color-surface-container); border-bottom: 1px solid var(--md-sys-color-outline-variant); flex-wrap: wrap; }
.zip-crumbs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; flex: 1; min-width: 0; }
.zip-crumb-btn { display: inline-flex; align-items: center; gap: 4px; border: 0; padding: 6px 10px; border-radius: 6px; background: none; color: var(--md-sys-color-on-surface); font-size: 13px; cursor: pointer; transition: background 120ms; }
.zip-crumb-btn:hover { background: var(--md-sys-color-surface-variant); }
.zip-crumb-btn md-icon { --md-icon-size: 18px; }
.zip-crumb-sep { color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.zip-meta { font-size: 12px; color: var(--md-sys-color-on-surface-variant); white-space: nowrap; }
.zip-table-wrap { width: 100%; max-width: 100%; max-height: 500px; overflow: auto; }
.zip-table { width: 100%; border-collapse: collapse; }
.zip-table td { padding: 8px 10px; border-bottom: 1px solid var(--md-sys-color-outline-variant); vertical-align: middle; }
.zip-row { transition: background 120ms; }
.zip-row:hover { background: var(--md-sys-color-surface-container); }
.zip-row--dir { cursor: pointer; }
.zip-row--dir:hover { background: color-mix(in srgb, var(--md-sys-color-secondary-container) 55%, transparent); }
.zip-row-up td { padding: 4px 10px; }
.zip-up-btn { display: inline-flex; align-items: center; gap: 6px; border: 0; padding: 8px 12px; border-radius: 6px; background: none; color: var(--md-sys-color-on-surface); font-size: 13px; cursor: pointer; transition: background 120ms; }
.zip-up-btn:hover { background: var(--md-sys-color-surface-variant); }
.zip-up-btn md-icon { --md-icon-size: 18px; }
.zip-name-cell { padding: 0 !important; width: 100%; }
.zip-name-content { min-width: 0; display: flex; align-items: center; gap: 8px; padding: 8px 10px; }
.zip-type-icon { --md-icon-size: 20px; color: var(--md-sys-color-on-surface-variant); flex-shrink: 0; }
.zip-type-icon--dir { color: var(--md-sys-color-primary); }
.zip-name { min-width: 0; font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; overflow-wrap: anywhere; }
.zip-actions { width: 48px; text-align: right; }
.zip-actions md-icon { --md-icon-size: 20px; color: var(--md-sys-color-on-surface-variant); }
.xlsx-preview { display: flex; flex-direction: column; gap: 20px; }
@media (max-width: 640px) {
  .media-stage { min-height: 140px; padding: 8px; }
  .markdown-preview,
  .document-preview { padding: 12px; }
  .zip-toolbar { align-items: flex-start; padding: 8px 10px; }
  .zip-meta { white-space: normal; overflow-wrap: anywhere; }
  .zip-table { min-width: 420px; }
}
</style>
