<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

const props = defineProps<{
  uuid: string
  daemonId: string
  instance?: any
  canView: boolean
  canEdit: boolean
}>()

const { showToast } = useToast()
const configFiles = ref<any[]>([])
const configLoading = ref(false)
const configCandidates = ref('server.properties')
const selectedFile = ref<any>(null)
const configText = ref('')
const configBusy = ref(false)
const taskName = ref('')
const taskParameter = ref('{}')
const taskResult = ref<any>(null)
const taskBusy = ref(false)
const settingsBusy = ref(false)
const settings = reactive({
  enableRcon: false,
  rconIp: '',
  rconPort: 25575,
  rconPassword: '',
  pingIp: '',
  pingPort: 25565,
  autoStart: false,
  autoRestart: false,
  terminalColor: true,
  terminalPty: false,
  terminalColumns: 120,
  terminalRows: 30,
  fileCode: 'utf-8',
  crlf: 0,
  stopCommand: '',
})

function base() { return { uuid: props.uuid, daemonId: props.daemonId } }
function errorMessage(error: any, fallback: string) { return error?.data?.statusMessage || error?.statusMessage || fallback }
function configType(file: any) {
  const name = String(file?.file || file?.name || '').toLowerCase()
  if (name.endsWith('.properties')) return 'properties'
  if (name.endsWith('.yml') || name.endsWith('.yaml')) return 'yml'
  if (name.endsWith('.toml')) return 'toml'
  if (name.endsWith('.txt')) return 'txt'
  return String(file?.type || file?.kind || 'json')
}

function syncInstance() {
  const item = props.instance || {}
  settings.enableRcon = Boolean(item.enableRcon)
  settings.rconIp = String(item.rconIp || '')
  settings.rconPort = Number(item.rconPort) || 25575
  settings.rconPassword = String(item.rconPassword || '')
  settings.pingIp = String(item.pingConfig?.ip || '')
  settings.pingPort = Number(item.pingConfig?.port) || 25565
  settings.autoStart = Boolean(item.autoStart)
  settings.autoRestart = Boolean(item.autoRestart)
  settings.terminalColor = item.terminalOption?.haveColor !== undefined ? Boolean(item.terminalOption.haveColor) : settings.terminalColor
  settings.terminalPty = item.terminalOption?.pty !== undefined ? Boolean(item.terminalOption.pty) : settings.terminalPty
  settings.terminalColumns = Number(item.terminalOption?.ptyWindowCol) || settings.terminalColumns
  settings.terminalRows = Number(item.terminalOption?.ptyWindowRow) || settings.terminalRows
  settings.fileCode = String(item.fileCode || settings.fileCode)
  settings.crlf = Number(item.crlf) || settings.crlf
  settings.stopCommand = String(item.stopCommand || '')
}

async function loadConfigFiles() {
  if (!props.canView || !props.uuid) return
  configLoading.value = true
  try {
    const result = await $fetch<{ files: any[] }>('/api/admin/mcsm/instance-config/list', { method: 'POST', body: { ...base(), files: configCandidates.value.split(',').map((item) => item.trim()).filter(Boolean) } })
    configFiles.value = result.files || []
    if (!selectedFile.value && configFiles.value.length) await openConfig(configFiles.value[0])
  } catch (error: any) { showToast(errorMessage(error, '进程配置列表加载失败'), 'error') }
  finally { configLoading.value = false }
}

async function openConfig(file: any) {
  selectedFile.value = file
  configBusy.value = true
  try {
    const data = await $fetch<any>('/api/admin/mcsm/instance-config/file', { query: { ...base(), fileName: file.file || file.name, type: configType(file) } })
    configText.value = JSON.stringify(data && typeof data === 'object' ? data : {}, null, 2)
  } catch (error: any) { showToast(errorMessage(error, '进程配置加载失败'), 'error') }
  finally { configBusy.value = false }
}

async function saveConfig() {
  if (!props.canEdit || !selectedFile.value || configBusy.value) return
  let config: any
  try { config = JSON.parse(configText.value) } catch { showToast('配置必须是合法 JSON', 'error'); return }
  configBusy.value = true
  try {
    await $fetch('/api/admin/mcsm/instance-config/file', { method: 'PUT', query: { ...base(), fileName: selectedFile.value.file || selectedFile.value.name, type: configType(selectedFile.value) }, body: { config } })
    showToast('进程配置已保存')
  } catch (error: any) { showToast(errorMessage(error, '进程配置保存失败'), 'error') }
  finally { configBusy.value = false }
}

async function saveSettings() {
  if (!props.canEdit || settingsBusy.value) return
  settingsBusy.value = true
  try {
    const payload: Record<string, unknown> = {
      enableRcon: settings.enableRcon, rconIp: settings.rconIp, rconPort: Number(settings.rconPort), rconPassword: settings.rconPassword,
      pingConfig: { ip: settings.pingIp, port: Number(settings.pingPort) }, eventTask: { autoStart: settings.autoStart, autoRestart: settings.autoRestart },
      terminalOption: { haveColor: settings.terminalColor, pty: settings.terminalPty, ptyWindowCol: Number(settings.terminalColumns), ptyWindowRow: Number(settings.terminalRows) },
      fileCode: settings.fileCode, crlf: Number(settings.crlf), stopCommand: settings.stopCommand,
    }
    if (!settings.rconPassword.trim()) delete payload.rconPassword
    await $fetch('/api/admin/mcsm/instance-config/settings', { method: 'PATCH', body: { ...base(), settings: payload } })
    showToast('实例设置已保存')
  } catch (error: any) { showToast(errorMessage(error, '实例设置保存失败'), 'error') }
  finally { settingsBusy.value = false }
}

async function startTask() {
  if (!props.canEdit || !taskName.value.trim() || taskBusy.value) return
  let parameter: any = {}
  try { parameter = JSON.parse(taskParameter.value || '{}') } catch { showToast('任务参数必须是合法 JSON', 'error'); return }
  taskBusy.value = true
  try { taskResult.value = await $fetch('/api/admin/mcsm/instance-config/async', { method: 'POST', body: { ...base(), taskName: taskName.value.trim(), parameter } }); showToast('异步任务已提交') }
  catch (error: any) { showToast(errorMessage(error, '异步任务提交失败'), 'error') }
  finally { taskBusy.value = false }
}

async function queryTask() {
  if (!taskName.value.trim()) return
  try { taskResult.value = await $fetch('/api/admin/mcsm/instance-config/async-status', { method: 'POST', body: { ...base(), taskName: taskName.value.trim(), parameter: JSON.parse(taskParameter.value || '{}') } }) }
  catch (error: any) { showToast(errorMessage(error, '异步任务查询失败'), 'error') }
}

async function stopTask() {
  if (!props.canEdit) return
  try { taskResult.value = await $fetch('/api/admin/mcsm/instance-config/async-stop', { method: 'POST', body: { ...base(), parameter: JSON.parse(taskParameter.value || '{}') } }); showToast('异步任务停止请求已提交') }
  catch (error: any) { showToast(errorMessage(error, '停止异步任务失败'), 'error') }
}

watch(() => [props.uuid, props.daemonId, props.instance], () => { syncInstance(); selectedFile.value = null; void loadConfigFiles() }, { immediate: true })
</script>

<template>
  <section v-if="canView" class="card instance-tools-card">
    <div class="card-heading"><div><h2 class="card-title">实例高级设置</h2><p class="card-note">管理普通用户可修改的 RCON、Ping、自动任务、终端与进程配置。</p></div><md-icon-button title="刷新进程配置" :disabled="configLoading" @click="loadConfigFiles"><md-icon>refresh</md-icon></md-icon-button></div>
    <div class="settings-grid">
      <label class="switch-row"><md-switch :selected="settings.enableRcon" :disabled="!canEdit" @change="settings.enableRcon = ($event.target as any).selected"></md-switch><span>启用 RCON</span></label>
      <md-outlined-text-field label="RCON 地址" :disabled="!canEdit" :value="settings.rconIp" @input="settings.rconIp = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
      <md-outlined-text-field label="RCON 端口" type="number" :disabled="!canEdit" :value="String(settings.rconPort)" @input="settings.rconPort = Number(($event.target as HTMLInputElement).value)"></md-outlined-text-field>
      <md-outlined-text-field label="RCON 密码" type="password" :disabled="!canEdit" :value="settings.rconPassword" @input="settings.rconPassword = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
      <md-outlined-text-field label="Ping 地址" :disabled="!canEdit" :value="settings.pingIp" @input="settings.pingIp = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
      <md-outlined-text-field label="Ping 端口" type="number" :disabled="!canEdit" :value="String(settings.pingPort)" @input="settings.pingPort = Number(($event.target as HTMLInputElement).value)"></md-outlined-text-field>
      <label class="switch-row"><md-switch :selected="settings.autoStart" :disabled="!canEdit" @change="settings.autoStart = ($event.target as any).selected"></md-switch><span>自动启动</span></label>
      <label class="switch-row"><md-switch :selected="settings.autoRestart" :disabled="!canEdit" @change="settings.autoRestart = ($event.target as any).selected"></md-switch><span>自动重启</span></label>
      <label class="switch-row"><md-switch :selected="settings.terminalColor" :disabled="!canEdit" @change="settings.terminalColor = ($event.target as any).selected"></md-switch><span>终端颜色</span></label>
      <label class="switch-row"><md-switch :selected="settings.terminalPty" :disabled="!canEdit" @change="settings.terminalPty = ($event.target as any).selected"></md-switch><span>PTY 终端</span></label>
      <md-outlined-text-field label="终端列数" type="number" :disabled="!canEdit" :value="String(settings.terminalColumns)" @input="settings.terminalColumns = Number(($event.target as HTMLInputElement).value)"></md-outlined-text-field>
      <md-outlined-text-field label="终端行数" type="number" :disabled="!canEdit" :value="String(settings.terminalRows)" @input="settings.terminalRows = Number(($event.target as HTMLInputElement).value)"></md-outlined-text-field>
      <md-outlined-text-field label="文件编码" :disabled="!canEdit" :value="settings.fileCode" @input="settings.fileCode = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
      <md-outlined-text-field label="停止命令" :disabled="!canEdit" :value="settings.stopCommand" @input="settings.stopCommand = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
    </div>
    <div class="form-actions"><md-filled-button :disabled="!canEdit || settingsBusy" @click="saveSettings">{{ settingsBusy ? '保存中…' : '保存实例设置' }}</md-filled-button></div>

    <h3 class="section-title">进程配置文件</h3>
    <div class="config-query"><md-outlined-text-field label="要检查的文件名（逗号分隔）" :disabled="!canView" :value="configCandidates" @input="configCandidates = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-outlined-button :disabled="configLoading" @click="loadConfigFiles">检查文件</md-outlined-button></div>
    <div class="config-layout"><div class="config-file-list"><button v-for="file in configFiles" :key="file.file || file.name" class="config-file" :class="{ active: selectedFile === file }" @click="openConfig(file)">{{ file.file || file.name }}</button><p v-if="!configLoading && !configFiles.length" class="empty">面板没有返回可编辑的进程配置文件。</p></div><div class="config-editor"><md-outlined-text-field type="textarea" rows="14" label="JSON 配置" :disabled="!selectedFile || configBusy" :readonly="!canEdit" :value="configText" @input="configText = ($event.target as HTMLTextAreaElement).value"></md-outlined-text-field><md-filled-button :disabled="!canEdit || !selectedFile || configBusy" @click="saveConfig">保存配置</md-filled-button></div></div>

    <h3 class="section-title">异步任务</h3><div class="task-grid"><md-outlined-text-field label="任务名称" :disabled="!canEdit" :value="taskName" @input="taskName = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-outlined-text-field label="参数 JSON" :disabled="!canEdit" :value="taskParameter" @input="taskParameter = ($event.target as HTMLInputElement).value"></md-outlined-text-field><div class="form-actions"><md-filled-button :disabled="!canEdit || taskBusy" @click="startTask">启动</md-filled-button><md-outlined-button @click="queryTask">查询</md-outlined-button><md-text-button :disabled="!canEdit" @click="stopTask">停止</md-text-button></div></div><pre v-if="taskResult !== null" class="result-preview">{{ JSON.stringify(taskResult, null, 2) }}</pre>
  </section>
</template>

<style scoped>
.card-heading,.form-actions,.task-grid,.config-query { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }.card-heading { justify-content:space-between; align-items:flex-start; }.card-note,.empty { color:var(--md-sys-color-on-surface-variant); font-size:13px; }.settings-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; margin-top:16px; }.switch-row { display:flex; align-items:center; gap:8px; min-height:56px; }.form-actions { margin-top:14px; }.section-title { margin:22px 0 10px; font-size:13px; }.config-query md-outlined-text-field { flex:1 1 280px; }.config-layout { display:grid; grid-template-columns:minmax(160px,0.5fr) minmax(0,1.5fr); gap:14px; }.config-file-list { border:1px solid var(--md-sys-color-outline-variant); min-height:100px; }.config-file { display:block; width:100%; padding:10px; border:0; border-bottom:1px solid var(--md-sys-color-outline-variant); background:transparent; color:inherit; text-align:left; cursor:pointer; }.config-file.active { background:var(--md-sys-color-secondary-container); }.config-editor { display:flex; flex-direction:column; gap:10px; }.config-editor md-outlined-text-field { width:100%; font-family:'Roboto Mono',ui-monospace,monospace; }.task-grid > md-outlined-text-field { flex:1 1 240px; }.result-preview { max-height:240px; overflow:auto; padding:12px; background:var(--md-sys-color-surface-container); font-size:12px; }
@media (max-width:700px) { .config-layout { grid-template-columns:1fr; } }
</style>
