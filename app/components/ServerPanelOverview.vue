<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ uuid: string; daemonId: string; canView: boolean; canJava: boolean; canEditLayout: boolean }>()
const { showToast } = useToast()
const overview = ref<any>(null)
const logs = ref<any[]>([])
const java = ref<any>(null)
const layoutText = ref('')
const layoutOpen = ref(false)
const loading = ref(false)
const logsLimit = ref(50)

function errorMessage(error: any, fallback: string) { return error?.data?.statusMessage || error?.statusMessage || fallback }
function pretty(value: any) { return JSON.stringify(value, null, 2) }
async function load() {
  if (!props.canView) return
  loading.value = true
  try {
    const [summary, operationLogs] = await Promise.all([
      $fetch('/api/admin/mcsm/overview'),
      $fetch<any>('/api/admin/mcsm/overview/logs', { query: { uuid: props.uuid, daemonId: props.daemonId, limit: logsLimit.value } }),
    ])
    overview.value = summary
    logs.value = Array.isArray(operationLogs) ? operationLogs : Array.isArray(operationLogs?.logs) ? operationLogs.logs : []
    if (props.canJava) java.value = await $fetch('/api/admin/mcsm/java', { query: { uuid: props.uuid, daemonId: props.daemonId } })
  } catch (error: any) { showToast(errorMessage(error, '面板概览加载失败'), 'error') }
  finally { loading.value = false }
}
async function loadLayout() {
  try { const data = await $fetch('/api/admin/mcsm/desktop-layout'); layoutText.value = pretty(data); layoutOpen.value = true }
  catch (error: any) { showToast(errorMessage(error, '桌面布局加载失败'), 'error') }
}
async function saveLayout() {
  if (!props.canEditLayout) return
  try { await $fetch('/api/admin/mcsm/desktop-layout', { method: 'POST', body: JSON.parse(layoutText.value) }); showToast('桌面布局已保存'); layoutOpen.value = false }
  catch (error: any) { showToast(errorMessage(error, '桌面布局保存失败'), 'error') }
}
watch(() => [props.uuid, props.daemonId, props.canView, props.canJava], () => { void load() }, { immediate: true })
</script>

<template>
  <section v-if="canView" class="card overview-card">
    <div class="card-heading"><div><h2 class="card-title">面板概览与日志</h2><p class="card-note">只读查看 MCSManager 面板概况、当前实例操作日志和 Java 环境。这里不提供 Java 切换或安装。</p></div><div class="heading-actions"><md-icon-button title="刷新概览" :disabled="loading" @click="load"><md-icon>refresh</md-icon></md-icon-button><md-outlined-button @click="loadLayout"><md-icon slot="icon">dashboard_customize</md-icon>桌面布局</md-outlined-button></div></div>
    <p v-if="loading" class="empty">加载中…</p>
    <div v-else class="overview-grid"><div><h3 class="section-title">面板概况</h3><pre class="json-preview">{{ pretty(overview || {}) }}</pre></div><div><h3 class="section-title">实例操作日志</h3><div class="log-list"><div v-for="(item, index) in logs" :key="item.id || item.time || index" class="log-row"><strong>{{ item.action || item.type || item.name || '操作' }}</strong><span>{{ item.time || item.createdAt || item.datetime || '' }}</span><small>{{ item.message || item.description || item.instanceName || pretty(item) }}</small></div><p v-if="!logs.length" class="empty">暂无日志。</p></div></div></div>
    <div v-if="canJava" class="java-block"><h3 class="section-title">Java 环境（只读）</h3><pre class="json-preview">{{ pretty(java || {}) }}</pre></div>
    <md-dialog :open="layoutOpen" @closed="layoutOpen = false"><div slot="headline">桌面布局</div><div slot="content" class="layout-dialog"><md-outlined-text-field type="textarea" rows="16" label="布局 JSON" :readonly="!canEditLayout" :value="layoutText" @input="layoutText = ($event.target as HTMLTextAreaElement).value"></md-outlined-text-field></div><div slot="actions"><md-text-button @click="layoutOpen = false">关闭</md-text-button><md-filled-button v-if="canEditLayout" @click="saveLayout">保存布局</md-filled-button></div></md-dialog>
  </section>
</template>

<style scoped>
.card-heading,.heading-actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }.card-heading { justify-content:space-between; align-items:flex-start; }.card-note,.empty { color:var(--md-sys-color-on-surface-variant); font-size:13px; }.overview-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin-top:12px; }.section-title { margin:12px 0 8px; font-size:13px; }.json-preview { max-height:260px; overflow:auto; padding:12px; margin:0; background:var(--md-sys-color-surface-container); font-size:12px; white-space:pre-wrap; overflow-wrap:anywhere; }.log-list { max-height:260px; overflow:auto; border:1px solid var(--md-sys-color-outline-variant); }.log-row { padding:10px; border-bottom:1px solid var(--md-sys-color-outline-variant); display:grid; gap:3px; }.log-row span,.log-row small { color:var(--md-sys-color-on-surface-variant); font-size:12px; }.java-block { margin-top:10px; }.layout-dialog { width:min(700px,calc(100vw - 64px)); }.layout-dialog md-outlined-text-field { width:100%; font-family:'Roboto Mono',ui-monospace,monospace; }
@media (max-width:760px) { .overview-grid { grid-template-columns:1fr; } }
</style>
