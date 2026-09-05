<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ uuid: string; daemonId: string; canView: boolean; canEdit: boolean }>()
const { showToast } = useToast()
const status = ref<any>(null)
const statusLoading = ref(false)
const chmodPath = ref('')
const chmodMode = ref('644')
const chmodDeep = ref(false)
const chmodBusy = ref(false)
const downloadUrl = ref('')
const downloadName = ref('')
const downloadBusy = ref(false)
const archivePath = ref('')
const archiveCode = ref('utf-8')
const archiveOpen = ref(false)
const archiveLoading = ref(false)
const archiveItems = ref<any[]>([])
let timer: ReturnType<typeof setInterval> | null = null
function base() { return { uuid: props.uuid, daemonId: props.daemonId } }
function errorMessage(error: any, fallback: string) { return error?.data?.statusMessage || error?.statusMessage || fallback }
async function loadStatus() {
  if (!props.canView || !props.uuid) return
  statusLoading.value = true
  try { status.value = await $fetch('/api/admin/mcsm/files/status', { query: base() }) }
  catch (error: any) { showToast(errorMessage(error, '文件任务状态加载失败'), 'error') }
  finally { statusLoading.value = false }
}
async function chmod() {
  if (!props.canEdit || !chmodPath.value.trim()) return
  chmodBusy.value = true
  try { await $fetch('/api/admin/mcsm/files/chmod', { method: 'POST', body: { ...base(), paths: [chmodPath.value.trim()], mode: Number.parseInt(chmodMode.value, 8), deep: chmodDeep.value } }); showToast('文件权限已更新'); await loadStatus() }
  catch (error: any) { showToast(errorMessage(error, '修改文件权限失败'), 'error') }
  finally { chmodBusy.value = false }
}
async function downloadFromUrl() {
  if (!props.canEdit || !downloadUrl.value.trim() || !downloadName.value.trim()) return
  downloadBusy.value = true
  try { await $fetch('/api/admin/mcsm/files/download-from-url', { method: 'POST', body: { ...base(), url: downloadUrl.value.trim(), fileName: downloadName.value.trim() } }); showToast('URL 下载任务已提交'); downloadUrl.value = ''; await loadStatus() }
  catch (error: any) { showToast(errorMessage(error, 'URL 下载失败'), 'error') }
  finally { downloadBusy.value = false }
}
async function stopDownload(task: any) {
  if (!props.canEdit) return
  try { await $fetch('/api/admin/mcsm/files/stop-download', { method: 'POST', body: { ...base(), fileName: task.path } }); showToast('下载任务已停止'); await loadStatus() }
  catch (error: any) { showToast(errorMessage(error, '停止下载任务失败'), 'error') }
}
async function previewArchive() {
  if (!archivePath.value.trim()) return
  archiveLoading.value = true; archiveOpen.value = true
  try { const result = await $fetch<any>('/api/admin/mcsm/files/archive-preview', { query: { ...base(), path: archivePath.value.trim(), code: archiveCode.value } }); archiveItems.value = result.items || [] }
  catch (error: any) { showToast(errorMessage(error, '压缩包预览失败'), 'error'); archiveItems.value = [] }
  finally { archiveLoading.value = false }
}
watch(() => [props.uuid, props.daemonId, props.canView], () => { void loadStatus() }, { immediate: true })
watch(() => status.value?.downloadTasks?.length, (count) => { if (count && !timer) timer = setInterval(() => void loadStatus(), 2500); if (!count && timer) { clearInterval(timer); timer = null } })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <section v-if="canView" class="card file-advanced-card"><div class="card-heading"><div><h2 class="card-title">文件任务与高级操作</h2><p class="card-note">查看守护进程任务、修改 Unix 权限、从 URL 下载文件和预览归档目录。</p></div><md-icon-button title="刷新任务状态" :disabled="statusLoading" @click="loadStatus"><md-icon>refresh</md-icon></md-icon-button></div><div v-if="status" class="status-grid"><span>实例任务：{{ status.instanceFileTask || 0 }}</span><span>全局任务：{{ status.globalFileTask || 0 }}</span><span>URL 下载：{{ status.downloadFileFromURLTask || 0 }}</span><span v-if="status.platform">平台：{{ status.platform }}</span></div><div v-if="status?.downloadTasks?.length" class="task-list"><div v-for="task in status.downloadTasks" :key="task.path" class="task-row"><span class="mono">{{ task.path }}</span><span>{{ task.current || 0 }} / {{ task.total || 0 }}</span><md-icon-button v-if="canEdit" title="停止下载" @click="stopDownload(task)"><md-icon>stop</md-icon></md-icon-button></div></div><div class="advanced-grid"><div><h3 class="section-title">修改权限</h3><md-outlined-text-field label="文件或目录路径" :disabled="!canEdit" :value="chmodPath" @input="chmodPath = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-outlined-text-field label="权限（八进制）" :disabled="!canEdit" :value="chmodMode" @input="chmodMode = ($event.target as HTMLInputElement).value"></md-outlined-text-field><label class="switch-row"><md-checkbox :checked="chmodDeep" :disabled="!canEdit" @change="chmodDeep = ($event.target as any).checked"></md-checkbox><span>递归处理</span></label><md-filled-button :disabled="!canEdit || chmodBusy" @click="chmod">应用权限</md-filled-button></div><div><h3 class="section-title">从 URL 下载</h3><md-outlined-text-field label="远程 URL" :disabled="!canEdit" :value="downloadUrl" @input="downloadUrl = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-outlined-text-field label="保存路径" :disabled="!canEdit" :value="downloadName" @input="downloadName = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-filled-button :disabled="!canEdit || downloadBusy" @click="downloadFromUrl">开始下载</md-filled-button></div><div><h3 class="section-title">压缩包预览</h3><md-outlined-text-field label="压缩包路径" :value="archivePath" @input="archivePath = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-outlined-text-field label="文件编码" :value="archiveCode" @input="archiveCode = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-outlined-button :disabled="archiveLoading" @click="previewArchive">预览目录</md-outlined-button></div></div><md-dialog :open="archiveOpen" @closed="archiveOpen = false"><div slot="headline">压缩包目录</div><div slot="content" class="archive-dialog"><p v-if="archiveLoading">读取中…</p><table v-else class="data-table"><thead><tr><th>名称</th><th>大小</th><th>压缩后</th><th>时间</th></tr></thead><tbody><tr v-for="item in archiveItems" :key="item.name"><td class="mono">{{ item.name }}</td><td>{{ item.size || 0 }}</td><td>{{ item.compressedSize || 0 }}</td><td>{{ item.time || '—' }}</td></tr></tbody></table><p v-if="!archiveLoading && !archiveItems.length" class="empty">没有目录条目。</p></div><div slot="actions"><md-text-button @click="archiveOpen = false">关闭</md-text-button></div></md-dialog></section>
</template>

<style scoped>
.card-heading,.status-grid,.task-row,.advanced-grid { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }.card-heading { justify-content:space-between; align-items:flex-start; }.card-note,.empty { color:var(--md-sys-color-on-surface-variant); font-size:13px; }.status-grid { margin-top:14px; color:var(--md-sys-color-on-surface-variant); font-size:13px; }.task-list { margin-top:12px; }.task-row { padding:8px 0; border-bottom:1px solid var(--md-sys-color-outline-variant); }.task-row .mono { flex:1; overflow-wrap:anywhere; }.advanced-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); align-items:start; margin-top:12px; }.advanced-grid > div { display:flex; flex-direction:column; gap:10px; }.section-title { margin:12px 0 0; font-size:13px; }.switch-row { display:flex; align-items:center; gap:8px; }.archive-dialog { width:min(760px,calc(100vw - 64px)); max-height:60vh; overflow:auto; }.data-table { width:100%; border-collapse:collapse; }.data-table th,.data-table td { padding:9px; border-bottom:1px solid var(--md-sys-color-outline-variant); text-align:left; }.mono { font-family:'Roboto Mono',ui-monospace,monospace; font-size:12px; }
@media (max-width:820px) { .advanced-grid { grid-template-columns:1fr; } }
</style>
