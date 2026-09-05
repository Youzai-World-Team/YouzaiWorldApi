<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  uuid: string
  daemonId: string
  canView: boolean
  canEdit: boolean
}>()

interface ModEntry {
  file: string
  name?: string
  version?: string
  enabled?: boolean
  hash?: string
  folder?: string
  type?: string
  extraInfo?: any
}

const { showToast } = useToast()
const mods = ref<ModEntry[]>([])
const folders = ref<string[]>([])
const folder = ref('')
const loading = ref(false)
const localPage = ref(1)
const localTotal = ref(0)
const taskStatus = ref<any>({ downloadTasks: [] })
const query = ref('')
const searchSource = ref('all')
const searchVersion = ref('')
const searchType = ref('all')
const searchLoader = ref('all')
const searchEnvironment = ref('server')
const mcVersions = ref<string[]>([])
const searchLoading = ref(false)
const searchResults = ref<any[]>([])
const searchTotal = ref(0)
const searchPage = ref(1)
const searchLimit = ref(10)
const versionsOpen = ref(false)
const versionsLoading = ref(false)
const versions = ref<any[]>([])
const selectedProject = ref<any>(null)
const installBusy = ref(false)
const configOpen = ref(false)
const configLoading = ref(false)
const configFiles = ref<any[]>([])
const selectedConfig = ref<any>(null)

const localFilter = computed(() => {
  const text = query.value.trim().toLowerCase()
  return mods.value.filter((item) => !text || `${item.name || ''} ${item.file || ''}`.toLowerCase().includes(text))
})

function base() {
  return { uuid: props.uuid, daemonId: props.daemonId }
}

function errorMessage(error: any, fallback: string) {
  return error?.data?.statusMessage || error?.statusMessage || fallback
}

function modName(item: ModEntry) {
  return item.name || item.extraInfo?.project?.name || item.file || '未命名 Mod'
}

function resultHits(data: any): any[] {
  return Array.isArray(data?.hits) ? data.hits : Array.isArray(data) ? data : []
}

async function loadMods() {
  if (!props.uuid || !props.canView) return
  loading.value = true
  try {
    const data = await $fetch<any>('/api/admin/mcsm/mods/list', { query: { ...base(), page: localPage.value, pageSize: 50, folder: folder.value } })
    mods.value = Array.isArray(data?.mods) ? data.mods : []
    folders.value = Array.isArray(data?.folders) ? data.folders : []
    taskStatus.value = data || { downloadTasks: [] }
    localTotal.value = Number(data?.total) || mods.value.length
    const hashes = mods.value.map((item) => item.hash).filter((item): item is string => Boolean(item))
    if (hashes.length) {
      try {
        const info = await $fetch<Record<string, any>>('/api/admin/mcsm/mods/batch-info', { method: 'POST', body: { hashes } })
        mods.value = mods.value.map((item) => ({ ...item, extraInfo: item.extraInfo || info?.[item.hash || ''] }))
      } catch {
        // Local files remain usable when the remote metadata source is unavailable.
      }
    }
  } catch (error: any) {
    showToast(errorMessage(error, 'Mod 列表加载失败'), 'error')
  } finally {
    loading.value = false
  }
}

async function loadVersions() {
  try {
    const data = await $fetch<any>('/api/admin/mcsm/mods/minecraft-versions')
    mcVersions.value = Array.isArray(data) ? data : Array.isArray(data?.versions) ? data.versions : []
  } catch {
    mcVersions.value = []
  }
}

function changeFolder(value: string) {
  folder.value = value
  localPage.value = 1
  void loadMods()
}

async function toggle(item: ModEntry) {
  if (!props.canEdit) return
  try {
    await $fetch('/api/admin/mcsm/mods/toggle', { method: 'POST', body: { ...base(), fileName: item.file } })
    showToast('Mod 状态已切换')
    await loadMods()
  } catch (error: any) { showToast(errorMessage(error, '切换 Mod 失败'), 'error') }
}

async function remove(item: ModEntry) {
  if (!props.canEdit || !window.confirm(`确定删除 ${item.file} 吗？`)) return
  try {
    await $fetch('/api/admin/mcsm/mods/delete', { method: 'POST', body: { ...base(), fileName: item.file } })
    showToast('Mod 已删除')
    await loadMods()
  } catch (error: any) { showToast(errorMessage(error, '删除 Mod 失败'), 'error') }
}

async function stopTask(task: any) {
  if (!props.canEdit) return
  try {
    await $fetch('/api/admin/mcsm/mods/stop-transfer', { method: 'POST', body: { ...base(), fileName: task.path || task.fileName, type: 'download' } })
    showToast('下载任务已停止')
    await loadMods()
  } catch (error: any) { showToast(errorMessage(error, '停止下载任务失败'), 'error') }
}

async function search() {
  searchLoading.value = true
  try {
    const data = await $fetch<any>('/api/admin/mcsm/mods/search', { query: {
      query: query.value.trim(), source: searchSource.value, version: searchVersion.value,
      type: searchType.value, loader: searchLoader.value, environment: searchEnvironment.value,
      offset: (searchPage.value - 1) * searchLimit.value, limit: searchLimit.value,
    } })
    searchResults.value = resultHits(data)
    searchTotal.value = Number(data?.total_hits) || searchResults.value.length
  } catch (error: any) { showToast(errorMessage(error, 'Mod 搜索失败'), 'error') }
  finally { searchLoading.value = false }
}

async function openVersions(project: any) {
  selectedProject.value = project
  versionsOpen.value = true
  versionsLoading.value = true
  try {
    versions.value = await $fetch<any[]>('/api/admin/mcsm/mods/versions', { query: {
      projectId: project.project_id || project.id, source: project.source || 'Modrinth',
    } })
  } catch (error: any) { showToast(errorMessage(error, '版本列表加载失败'), 'error'); versions.value = [] }
  finally { versionsLoading.value = false }
}

async function install(version: any) {
  if (!props.canEdit || installBusy.value) return
  const file = Array.isArray(version?.files) ? version.files.find((item: any) => item.primary) || version.files[0] : null
  if (!file?.url) return
  const pluginLoaders = ['spigot', 'paper', 'purpur', 'folia', 'bungeecord', 'velocity', 'waterfall']
  const isPlugin = (version.loaders || []).some((item: string) => pluginLoaders.includes(String(item).toLowerCase()))
    || String(selectedProject.value?.source || '').toLowerCase() === 'spigotmc'
  installBusy.value = true
  try {
    await $fetch('/api/admin/mcsm/mods/install', { method: 'POST', body: {
      ...base(), url: file.url, fallbackUrl: Array.isArray(version.files) ? version.files.find((item: any) => item.url !== file.url)?.url : undefined,
      fileName: file.filename || file.name || String(file.url).split('/').pop(), projectType: isPlugin ? 'plugin' : 'mod',
      extraInfo: { project: { id: selectedProject.value?.id, name: selectedProject.value?.title || selectedProject.value?.name }, version: { id: version.id, name: version.name, version_number: version.version_number }, source: selectedProject.value?.source },
    } })
    showToast('Mod 下载任务已提交')
    versionsOpen.value = false
    await loadMods()
  } catch (error: any) { showToast(errorMessage(error, '安装 Mod 失败'), 'error') }
  finally { installBusy.value = false }
}

async function openConfig(item: ModEntry) {
  if (!item.hash && !item.file) return
  configOpen.value = true
  configLoading.value = true
  try {
    const data = await $fetch<any>('/api/admin/mcsm/mods/config-files', { query: { ...base(), modId: item.extraInfo?.project?.id || item.name || item.file, type: item.type || (item.folder === 'plugins' ? 'plugin' : 'mod'), fileName: item.file } })
    configFiles.value = Array.isArray(data) ? data : Array.isArray(data?.files) ? data.files : []
    selectedConfig.value = item
  } catch (error: any) { showToast(errorMessage(error, 'Mod 配置文件加载失败'), 'error'); configOpen.value = false }
  finally { configLoading.value = false }
}

watch(() => [props.uuid, props.daemonId, props.canView], () => { void loadMods(); void loadVersions() }, { immediate: true })
</script>

<template>
  <section v-if="canView" class="card server-mods-card">
    <div class="card-heading">
      <div>
        <h2 class="card-title">Mod 与插件</h2>
        <p class="card-note">查看、搜索、安装、启用或删除实例内的 Mod 与插件。</p>
      </div>
      <div class="heading-actions">
        <md-outlined-select label="目录" :value="folder" @change="changeFolder(($event.target as HTMLSelectElement).value)">
          <md-select-option value="" :selected="!folder">全部</md-select-option>
          <md-select-option v-for="item in folders" :key="item" :value="item" :selected="folder === item">{{ item }}</md-select-option>
        </md-outlined-select>
        <md-icon-button aria-label="刷新 Mod" title="刷新 Mod" :disabled="loading" @click="loadMods"><md-icon>refresh</md-icon></md-icon-button>
      </div>
    </div>

    <div class="mod-toolbar">
      <md-outlined-text-field label="筛选本地文件" :value="query" @input="query = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
      <span class="muted">{{ localFilter.length }} 项</span>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>名称</th><th>文件</th><th>版本</th><th>状态</th><th class="cell-actions">操作</th></tr></thead>
        <tbody>
          <tr v-for="item in localFilter" :key="item.file">
            <td class="primary-cell">{{ modName(item) }}</td><td class="mono">{{ item.file }}</td><td>{{ item.version || item.extraInfo?.version?.version_number || '—' }}</td>
            <td><span class="badge">{{ item.enabled === false || item.file?.endsWith('.disabled') ? '已禁用' : '已启用' }}</span></td>
            <td class="cell-actions"><md-icon-button :disabled="!canEdit" :title="item.enabled === false ? '启用' : '禁用'" @click="toggle(item)"><md-icon>{{ item.enabled === false ? 'toggle_off' : 'toggle_on' }}</md-icon></md-icon-button><md-icon-button title="配置文件" @click="openConfig(item)"><md-icon>settings</md-icon></md-icon-button><md-icon-button class="danger" :disabled="!canEdit" title="删除" @click="remove(item)"><md-icon>delete</md-icon></md-icon-button></td>
          </tr>
        </tbody>
      </table>
      <p v-if="loading" class="empty">加载中…</p><p v-else-if="!localFilter.length" class="empty">当前目录没有 Mod 或插件。</p>
      <div v-if="localTotal > 50" class="pager"><md-text-button :disabled="localPage <= 1" @click="localPage--; loadMods()">上一页</md-text-button><span>第 {{ localPage }} 页 / {{ localTotal }} 项</span><md-text-button :disabled="localPage * 50 >= localTotal" @click="localPage++; loadMods()">下一页</md-text-button></div>
    </div>

    <div v-if="taskStatus.downloadTasks?.length" class="task-list">
      <h3 class="section-title">下载任务</h3>
      <div v-for="task in taskStatus.downloadTasks" :key="task.path || task.fileName" class="task-row"><span class="mono">{{ task.path || task.fileName }}</span><span>{{ task.current || 0 }} / {{ task.total || 0 }}</span><md-icon-button v-if="canEdit" title="停止任务" @click="stopTask(task)"><md-icon>stop</md-icon></md-icon-button></div>
    </div>

    <div class="search-panel">
      <h3 class="section-title">在线搜索与安装</h3>
      <div class="filter-grid">
        <md-outlined-text-field label="关键词" :value="query" @input="query = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
        <md-outlined-select label="来源" :value="searchSource" @change="searchSource = ($event.target as HTMLSelectElement).value"><md-select-option value="all">全部</md-select-option><md-select-option value="modrinth">Modrinth</md-select-option><md-select-option value="curseforge">CurseForge</md-select-option><md-select-option value="spigotmc">SpigotMC</md-select-option></md-outlined-select>
        <md-outlined-select label="Minecraft 版本" :value="searchVersion" @change="searchVersion = ($event.target as HTMLSelectElement).value"><md-select-option value="" :selected="!searchVersion">全部版本</md-select-option><md-select-option v-for="version in mcVersions" :key="version" :value="version" :selected="searchVersion === version">{{ version }}</md-select-option></md-outlined-select>
        <md-outlined-select label="类型" :value="searchType" @change="searchType = ($event.target as HTMLSelectElement).value"><md-select-option value="all">全部</md-select-option><md-select-option value="mod">Mod</md-select-option><md-select-option value="plugin">插件</md-select-option></md-outlined-select>
        <md-outlined-text-field label="加载器" :value="searchLoader" @input="searchLoader = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
        <md-outlined-select label="运行环境" :value="searchEnvironment" @change="searchEnvironment = ($event.target as HTMLSelectElement).value"><md-select-option value="all" :selected="searchEnvironment === 'all'">全部</md-select-option><md-select-option value="server" :selected="searchEnvironment === 'server'">服务器</md-select-option><md-select-option value="client" :selected="searchEnvironment === 'client'">客户端</md-select-option></md-outlined-select>
        <md-filled-button :disabled="searchLoading" @click="search"><md-icon slot="icon">search</md-icon>搜索</md-filled-button>
      </div>
      <div v-if="searchResults.length" class="table-wrap">
        <table class="data-table"><thead><tr><th>项目</th><th>来源</th><th>类型</th><th>版本</th><th class="cell-actions">操作</th></tr></thead><tbody><tr v-for="item in searchResults" :key="item.id || item.project_id"><td class="primary-cell">{{ item.title || item.name }}</td><td>{{ item.source || '—' }}</td><td>{{ item.project_type || item.type || '—' }}</td><td>{{ item.latest_version || item.version || '—' }}</td><td class="cell-actions"><md-outlined-button @click="openVersions(item)">查看版本</md-outlined-button></td></tr></tbody></table>
        <div class="pager"><md-text-button :disabled="searchPage <= 1" @click="searchPage--; search()">上一页</md-text-button><span>第 {{ searchPage }} 页 / {{ searchTotal }} 项</span><md-text-button :disabled="searchPage * searchLimit >= searchTotal" @click="searchPage++; search()">下一页</md-text-button></div>
      </div>
    </div>

    <md-dialog :open="versionsOpen" @closed="versionsOpen = false"><div slot="headline">选择 {{ selectedProject?.title || selectedProject?.name || '项目' }} 的版本</div><div slot="content" class="dialog-list"><p v-if="versionsLoading">加载中…</p><button v-for="version in versions" :key="version.id" class="version-row" :disabled="!canEdit || installBusy" @click="install(version)"><span>{{ version.name || version.version_number }}</span><small>{{ (version.game_versions || []).join(', ') }} · {{ (version.loaders || []).join(', ') }}</small></button><p v-if="!versionsLoading && !versions.length">没有可用版本。</p></div><div slot="actions"><md-text-button @click="versionsOpen = false">关闭</md-text-button></div></md-dialog>
    <md-dialog :open="configOpen" @closed="configOpen = false"><div slot="headline">{{ modName(selectedConfig || {}) }} 配置文件</div><div slot="content" class="dialog-list"><p v-if="configLoading">加载中…</p><a v-for="file in configFiles" :key="String(file.path || file.name || file)" :href="`/server-files?uuid=${encodeURIComponent(uuid)}&daemonId=${encodeURIComponent(daemonId)}&path=${encodeURIComponent(String(file.path || file.name || file))}`" class="config-link">{{ file.path || file.name || file }}</a><p v-if="!configLoading && !configFiles.length">该 Mod 没有可识别的配置文件。</p></div><div slot="actions"><md-text-button @click="configOpen = false">关闭</md-text-button></div></md-dialog>
  </section>
</template>

<style scoped>
.card-heading,.heading-actions,.mod-toolbar,.task-row,.pager { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.card-heading { justify-content:space-between; align-items:flex-start; }
.mod-toolbar { margin-top:16px; }
.mod-toolbar md-outlined-text-field { flex:1 1 280px; }
.table-wrap { overflow-x:auto; margin-top:14px; }
.data-table { width:100%; border-collapse:collapse; }
.data-table th,.data-table td { padding:10px; border-bottom:1px solid var(--md-sys-color-outline-variant); text-align:left; white-space:nowrap; }
.data-table th { color:var(--md-sys-color-on-surface-variant); font-size:12px; }
.primary-cell { font-weight:600; }.cell-actions { text-align:right; }.mono { font-family:'Roboto Mono',ui-monospace,monospace; font-size:12px; }.muted,.empty,.card-note { color:var(--md-sys-color-on-surface-variant); font-size:13px; }.empty { padding:14px 0; }.danger { color:var(--md-sys-color-error); }.badge { padding:3px 8px; border-radius:999px; background:var(--md-sys-color-secondary-container); font-size:11px; }.section-title { margin:20px 0 10px; font-size:13px; }.task-list { margin-top:10px; }.task-row { padding:8px 0; border-bottom:1px solid var(--md-sys-color-outline-variant); }.task-row .mono { flex:1; overflow-wrap:anywhere; }.search-panel { margin-top:20px; }.filter-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }.pager { justify-content:center; margin-top:10px; }.dialog-list { width:min(680px,calc(100vw - 64px)); max-height:60vh; overflow:auto; }.version-row { width:100%; display:flex; flex-direction:column; align-items:flex-start; gap:4px; border:0; border-bottom:1px solid var(--md-sys-color-outline-variant); padding:12px 4px; background:transparent; color:inherit; text-align:left; cursor:pointer; }.version-row:hover { background:var(--md-sys-color-surface-container); }.version-row small { color:var(--md-sys-color-on-surface-variant); }.config-link { display:block; padding:9px 4px; color:var(--md-sys-color-primary); }
</style>
