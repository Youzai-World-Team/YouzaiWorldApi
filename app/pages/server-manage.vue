<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

useHead({ title: '服务器管理' })

interface PanelUser {
  userName: string
  permission: number
  permissionLabel: string
}

interface InstanceSummary {
  instanceUuid: string
  daemonId: string
  nickname: string
  status: number
  statusLabel: string
  hostIp: string
  remarks: string
  processType: string
  stopCommand: string
  lastDatetime: number
  endTime: number
  currentPlayers: number
  maxPlayers: number
  version: string
  latency: number
  online: boolean
}

interface InstanceDetail extends InstanceSummary {
  started: number
  cwd: string
  type: string
  startCommandConfigured: boolean
  createDatetime: number
  storageUsage: number
  storageLimit: number
  processInfo: { cpu: number; memory: number; pid: number; elapsed: number }
  pingConfig: { ip: string; port: number }
  autoStart: boolean
  autoRestart: boolean
}

interface BackupEntry {
  name: string
  size: number
  time: string
}

type PowerAction = 'open' | 'stop' | 'restart' | 'kill'

const POWER_LABELS: Record<PowerAction, string> = {
  open: '启动',
  stop: '停止',
  restart: '重启',
  kill: '强制结束进程',
}

const POWER_CONFIRM: Record<PowerAction, string> = {
  open: '',
  stop: '服务器会执行停止命令并保存存档，所有在线玩家都会被断开连接。',
  restart: '服务器会先停止再启动，所有在线玩家都会被断开连接。',
  kill: '直接杀掉服务器进程，不会执行存档保存，最近若干分钟的进度可能丢失。仅在服务器卡死、停止无效时使用。',
}

// 控制台尾部长度：面板存的是整份终端历史，取太多会让页面每次刷新都搬几十万字符。
// 面板的 size 参数单位是字符数，不是文档说的 KB。
const LOG_SIZE_OPTIONS = [
  { value: 20000, label: '最近 2 万字符' },
  { value: 60000, label: '最近 6 万字符' },
  { value: 200000, label: '最近 20 万字符' },
]
// 状态轮询周期：控制台走 SSE 后，这里只剩玩家数/CPU/内存要刷，放宽到 10 秒。
const STATUS_INTERVAL_MS = 10000
const QUICK_COMMANDS = ['list', 'save-all', 'whitelist list']

const { showToast } = useToast()
const access = useAdminAccess()
const canEditPage = computed(() => access.levelForKey('server-manage') === 'edit')
const canPower = computed(() => canEditPage.value && access.featureLevelForKey('server-manage-power') === 'edit')
const canCommand = computed(() => canEditPage.value && access.featureLevelForKey('server-manage-command') === 'edit')
const canBackup = computed(() => canEditPage.value && access.featureLevelForKey('server-manage-backup') === 'edit')
// 这三块各自有独立区域权限：hidden 时整个卡片不渲染，view 时只读。
const propertiesLevel = computed(() => access.featureLevelForKey('server-manage-properties'))
const scheduleLevel = computed(() => access.featureLevelForKey('server-manage-schedule'))
const canEditProperties = computed(() => canEditPage.value && propertiesLevel.value === 'edit')
const canEditSchedule = computed(() => canEditPage.value && scheduleLevel.value === 'edit')

const loading = ref(true)
const configured = ref(false)
const panelUser = ref<PanelUser | null>(null)
const panelBaseUrl = ref('')
const instances = ref<InstanceSummary[]>([])
const selectedKey = ref('')

const detail = ref<InstanceDetail | null>(null)
const detailLoading = ref(false)

const logText = ref('')
const logLoading = ref(false)
const logSizeChars = ref(60000)
const autoScroll = ref(true)
const consoleBox = ref<HTMLElement | null>(null)
// live：SSE 实时流；paused：用户暂停后停在快照上，靠手动刷新。
const liveMode = ref(true)
const liveState = ref<'connecting' | 'open' | 'closed'>('connecting')
let eventSource: EventSource | null = null
// 增量输出先攒到缓冲里，按帧批量并进 logText，避免每个片段都触发一次重渲染。
let logBuffer = ''
let flushTimer: ReturnType<typeof setTimeout> | null = null
// 实时模式下把控制台留存的字符数封顶，超出就从头部丢，防止长时间挂着把内存撑爆。
const LIVE_LOG_MAX_CHARS = 400_000

const command = ref('')
const sending = ref(false)
const commandHistory = ref<string[]>([])
const historyCursor = ref(-1)

const backupDir = ref('/backups')
const backups = ref<BackupEntry[]>([])
const directories = ref<string[]>([])
const backupsLoading = ref(false)

const createOpen = ref(false)
const createLabel = ref('')
const createTargets = ref<string[]>([])
const creating = ref(false)
const createDialog = ref<HTMLElement | null>(null)

const powerConfirm = ref<PowerAction | null>(null)
const powerPending = ref(false)
const restoreTarget = ref<BackupEntry | null>(null)
const restorePending = ref(false)
const deleteTarget = ref<BackupEntry | null>(null)
const deletePending = ref(false)

const downloadUrl = ref('')
const downloadName = ref('')
const downloadDialog = ref<HTMLElement | null>(null)

const { apply: applyDialogAnimation } = useDialogAnimation()

let timer: ReturnType<typeof setInterval> | null = null
// 刷新在飞时不再叠加下一轮：面板在慢节点上单次响应可能超过一个轮询周期。
let refreshing = false

const selected = computed(() => instances.value.find((item) => instanceKey(item) === selectedKey.value) || null)
const current = computed<InstanceSummary | InstanceDetail | null>(() => detail.value || selected.value)
const stopped = computed(() => current.value?.status === 0)
const running = computed(() => current.value?.status === 3)
// 备份目录本身不能当备份目标，否则历史备份会被一层层套进新备份。
const backupDirRoot = computed(() => backupDir.value.split('/').filter(Boolean)[0] || '')
const selectableDirectories = computed(() => directories.value.filter((name) => name !== backupDirRoot.value))

function instanceKey(item: { daemonId: string; instanceUuid: string }) {
  return `${item.daemonId}:${item.instanceUuid}`
}

function statusClass(status: number | undefined) {
  if (status === 3) return 'badge-running'
  if (status === 0) return 'badge-stopped'
  if (status === -1) return 'badge-busy'
  return 'badge-pending'
}

function formatBytes(value: number) {
  if (!value) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`
}

function formatDate(value: number) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN')
}

/** 面板给的是毫秒级运行时长。 */
function formatDuration(value: number) {
  if (!value || value < 0) return '—'
  const totalMinutes = Math.floor(value / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days) return `${days} 天 ${hours} 小时`
  if (hours) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分`
}

/** 守护进程上报的 CPU 占用在不同版本里有时是 0~1 的比例、有时已经是百分数。 */
function formatCpu(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0%'
  return `${(value <= 1 ? value * 100 : value).toFixed(1)}%`
}

function playersLabel(item: InstanceSummary | InstanceDetail | null) {
  if (!item || item.currentPlayers < 0) return '—'
  return `${item.currentPlayers} / ${item.maxPlayers}`
}

function errorMessage(error: any, fallback: string) {
  return error?.data?.statusMessage || error?.statusMessage || fallback
}

async function loadInstances() {
  loading.value = true
  try {
    const result = await $fetch<{
      configured: boolean
      backupDir: string
      baseUrl?: string
      user: PanelUser | null
      instances: InstanceSummary[]
    }>('/api/admin/mcsm/instances')
    configured.value = result.configured
    backupDir.value = result.backupDir
    panelBaseUrl.value = result.baseUrl || ''
    panelUser.value = result.user
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

async function loadDetail(quiet = false) {
  const target = selected.value
  if (!target) {
    detail.value = null
    return
  }
  if (!quiet) detailLoading.value = true
  try {
    detail.value = await $fetch<InstanceDetail>('/api/admin/mcsm/instance', {
      query: { uuid: target.instanceUuid, daemonId: target.daemonId },
    })
  } catch (error: any) {
    if (!quiet) showToast(errorMessage(error, '实例状态加载失败'), 'error')
  } finally {
    detailLoading.value = false
  }
}

async function loadLog(quiet = false) {
  const target = selected.value
  if (!target) {
    logText.value = ''
    return
  }
  if (!quiet) logLoading.value = true
  try {
    const result = await $fetch<{ text: string; rawBytes: number }>('/api/admin/mcsm/log', {
      query: { uuid: target.instanceUuid, daemonId: target.daemonId, size: logSizeChars.value },
    })
    logText.value = result.text
    if (autoScroll.value) scrollConsoleToBottom()
  } catch (error: any) {
    if (!quiet) showToast(errorMessage(error, '控制台输出加载失败'), 'error')
  } finally {
    logLoading.value = false
  }
}

/** 把攒着的增量输出并进 logText，并按上限从头部裁剪。 */
function flushLogBuffer() {
  flushTimer = null
  if (!logBuffer) return
  let next = logText.value + logBuffer
  logBuffer = ''
  if (next.length > LIVE_LOG_MAX_CHARS) {
    next = next.slice(next.length - LIVE_LOG_MAX_CHARS)
  }
  logText.value = next
  if (autoScroll.value) scrollConsoleToBottom()
}

function appendLive(text: string) {
  if (!text) return
  logBuffer += text
  // 60ms 合并一次：崩服刷屏时也不会每帧都重渲染。
  if (!flushTimer) flushTimer = setTimeout(flushLogBuffer, 60)
}

function closeStream() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  logBuffer = ''
}

/**
 * 打开实时控制台 SSE。
 * <p>
 * history 事件先补一段历史铺满屏幕，log 事件是增量输出，status 事件报通道状态。
 * EventSource 自带断线重连，这里只在拿到 open 状态时把提示归位。
 * </p>
 */
function openStream() {
  const target = selected.value
  if (!target || !liveMode.value) return
  closeStream()
  liveState.value = 'connecting'
  logText.value = ''
  const params = new URLSearchParams({
    uuid: target.instanceUuid,
    daemonId: target.daemonId,
    history: String(logSizeChars.value),
  })
  const source = new EventSource(`/api/admin/mcsm/stream?${params.toString()}`)
  eventSource = source

  source.addEventListener('history', (event) => {
    logText.value = (event as MessageEvent).data ? JSON.parse((event as MessageEvent).data).text : ''
    if (autoScroll.value) scrollConsoleToBottom()
  })
  source.addEventListener('log', (event) => {
    appendLive(JSON.parse((event as MessageEvent).data).text)
  })
  source.addEventListener('status', (event) => {
    const payload = JSON.parse((event as MessageEvent).data)
    if (payload.state === 'open') liveState.value = 'open'
    else if (payload.state === 'closed' || payload.state === 'error') {
      liveState.value = 'closed'
      if (payload.message) showToast(payload.message, payload.state === 'error' ? 'error' : 'info')
    } else if (payload.state === 'warn' && payload.message) {
      showToast(payload.message, 'error')
    }
  })
  // 服务端主动 close 或网络断开：EventSource 会自己重连，这里先标记为连接中。
  source.onerror = () => {
    if (liveState.value === 'open') liveState.value = 'connecting'
  }
}

function toggleLive() {
  liveMode.value = !liveMode.value
  if (liveMode.value) {
    openStream()
  } else {
    closeStream()
    liveState.value = 'closed'
    // 暂停时把当前时刻的完整快照补一次，别停在增量攒到一半的状态。
    void loadLog(true)
  }
}

async function loadBackups(quiet = false) {
  const target = selected.value
  if (!target) {
    backups.value = []
    directories.value = []
    return
  }
  if (!quiet) backupsLoading.value = true
  try {
    const result = await $fetch<{ backupDir: string; backups: BackupEntry[]; directories: string[] }>(
      '/api/admin/mcsm/backups',
      { query: { uuid: target.instanceUuid, daemonId: target.daemonId } },
    )
    backupDir.value = result.backupDir
    backups.value = result.backups
    directories.value = result.directories
  } catch (error: any) {
    if (!quiet) showToast(errorMessage(error, '备份列表加载失败'), 'error')
  } finally {
    backupsLoading.value = false
  }
}

function scrollConsoleToBottom() {
  const box = consoleBox.value
  if (!box) return
  requestAnimationFrame(() => {
    box.scrollTop = box.scrollHeight
  })
}

// 状态（详情）仍然轮询，但控制台走 SSE 实时流，不再随轮询拉日志。
async function refreshAll(quiet = false) {
  if (refreshing) return
  refreshing = true
  try {
    await loadDetail(quiet)
    // 暂停实时模式时，刷新按钮顺带把控制台快照也更新一次。
    if (!liveMode.value && !quiet) await loadLog(true)
  } finally {
    refreshing = false
  }
}

function onInstanceChange(event: Event) {
  selectedKey.value = (event.target as HTMLSelectElement).value
}

function onLogSizeChange(event: Event) {
  logSizeChars.value = Number((event.target as HTMLSelectElement).value) || 60000
  // 实时模式下改历史长度就重连（重新补一段历史）；暂停模式下直接重拉快照。
  if (liveMode.value) openStream()
  else void loadLog()
}

function onAutoScrollChange(event: Event) {
  autoScroll.value = (event.target as any).checked
  if (autoScroll.value) scrollConsoleToBottom()
}

function requestPower(action: PowerAction) {
  if (!canPower.value) return
  // 启动没有破坏性，不必再拦一道；其余三个都会断开在线玩家。
  if (action === 'open') {
    void runPower(action)
    return
  }
  powerConfirm.value = action
}

async function runPower(action: PowerAction) {
  const target = selected.value
  if (!target || !canPower.value || powerPending.value) return
  powerPending.value = true
  try {
    await $fetch('/api/admin/mcsm/power', {
      method: 'POST',
      body: { uuid: target.instanceUuid, daemonId: target.daemonId, action },
    })
    showToast(`已提交${POWER_LABELS[action]}指令`)
    powerConfirm.value = null
    // 面板状态是异步变的，稍等一下再拉，避免刚提交就显示旧状态。
    setTimeout(() => {
      void loadInstances()
      void refreshAll(true)
    }, 1200)
  } catch (error: any) {
    showToast(errorMessage(error, `${POWER_LABELS[action]}失败`), 'error')
  } finally {
    powerPending.value = false
  }
}

async function sendCommand() {
  const target = selected.value
  const text = command.value.trim()
  if (!target || !canCommand.value || sending.value || !text) return
  sending.value = true
  try {
    await $fetch('/api/admin/mcsm/command', {
      method: 'POST',
      body: { uuid: target.instanceUuid, daemonId: target.daemonId, command: text },
    })
    commandHistory.value = [text, ...commandHistory.value.filter((item) => item !== text)].slice(0, 30)
    historyCursor.value = -1
    command.value = ''
    // 实时模式下回显会自己推过来，只有暂停时才需要手动补一次。
    if (!liveMode.value) setTimeout(() => void loadLog(true), 900)
  } catch (error: any) {
    showToast(errorMessage(error, '命令发送失败'), 'error')
  } finally {
    sending.value = false
  }
}

function onCommandKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    void sendCommand()
    return
  }
  if (event.key === 'ArrowUp' && commandHistory.value.length) {
    event.preventDefault()
    historyCursor.value = Math.min(historyCursor.value + 1, commandHistory.value.length - 1)
    command.value = commandHistory.value[historyCursor.value] || ''
    return
  }
  if (event.key === 'ArrowDown' && commandHistory.value.length) {
    event.preventDefault()
    historyCursor.value = Math.max(historyCursor.value - 1, -1)
    command.value = historyCursor.value < 0 ? '' : commandHistory.value[historyCursor.value] || ''
  }
}

function goToSettings() {
  void navigateTo('/settings')
}

function openCreateBackup() {
  if (!canBackup.value) return
  createLabel.value = ''
  // 默认勾上世界存档目录（server.properties 的 level-name 通常就叫 world/World）。
  createTargets.value = selectableDirectories.value.filter((name) => /^world$/i.test(name))
  createOpen.value = true
}

function toggleCreateTarget(name: string) {
  createTargets.value = createTargets.value.includes(name)
    ? createTargets.value.filter((item) => item !== name)
    : [...createTargets.value, name]
}

async function submitCreateBackup() {
  const target = selected.value
  if (!target || !canBackup.value || creating.value) return
  if (!createTargets.value.length) {
    showToast('请至少选择一个要备份的目录', 'error')
    return
  }
  creating.value = true
  try {
    const result = await $fetch<{ name: string }>('/api/admin/mcsm/backups', {
      method: 'POST',
      body: {
        uuid: target.instanceUuid,
        daemonId: target.daemonId,
        label: createLabel.value.trim(),
        targets: createTargets.value,
      },
    })
    showToast(`备份 ${result.name} 已创建`)
    createOpen.value = false
    await loadBackups(true)
  } catch (error: any) {
    showToast(errorMessage(error, '创建备份失败'), 'error')
  } finally {
    creating.value = false
  }
}

async function confirmRestore() {
  const target = selected.value
  const backup = restoreTarget.value
  if (!target || !backup || !canBackup.value || restorePending.value) return
  restorePending.value = true
  try {
    await $fetch('/api/admin/mcsm/backups/restore', {
      method: 'POST',
      body: { uuid: target.instanceUuid, daemonId: target.daemonId, name: backup.name },
    })
    showToast(`已用 ${backup.name} 恢复，可以启动服务器了`)
    restoreTarget.value = null
  } catch (error: any) {
    showToast(errorMessage(error, '恢复备份失败'), 'error')
  } finally {
    restorePending.value = false
  }
}

async function confirmDelete() {
  const target = selected.value
  const backup = deleteTarget.value
  if (!target || !backup || !canBackup.value || deletePending.value) return
  deletePending.value = true
  try {
    await $fetch('/api/admin/mcsm/backups', {
      method: 'DELETE',
      body: { uuid: target.instanceUuid, daemonId: target.daemonId, name: backup.name },
    })
    showToast(`备份 ${backup.name} 已删除`)
    deleteTarget.value = null
    await loadBackups(true)
  } catch (error: any) {
    showToast(errorMessage(error, '删除备份失败'), 'error')
  } finally {
    deletePending.value = false
  }
}

async function requestDownload(backup: BackupEntry) {
  const target = selected.value
  if (!target || !canBackup.value) return
  try {
    const result = await $fetch<{ url: string }>('/api/admin/mcsm/backups/download', {
      method: 'POST',
      body: { uuid: target.instanceUuid, daemonId: target.daemonId, name: backup.name },
    })
    downloadName.value = backup.name
    downloadUrl.value = result.url
  } catch (error: any) {
    showToast(errorMessage(error, '获取下载地址失败'), 'error')
  }
}

async function copyDownloadUrl() {
  try {
    await navigator.clipboard.writeText(downloadUrl.value)
    showToast('下载地址已复制')
  } catch {
    showToast('复制失败，请手动选中地址复制', 'error')
  }
}

watch(selectedKey, async (key) => {
  closeStream()
  logText.value = ''
  detail.value = null
  if (!key) return
  // 实时流自己会补历史；暂停模式下由 refreshAll 拉快照。
  if (liveMode.value) openStream()
  await Promise.all([refreshAll(), loadBackups()])
})

onMounted(async () => {
  applyDialogAnimation(createDialog.value)
  applyDialogAnimation(downloadDialog.value)
  // 首次的状态、输出、备份都由 selectedKey 的 watcher 触发，这里不再重复拉一遍。
  await loadInstances()
  // 状态（玩家数、CPU、内存）没有推流通道，仍然轮询；控制台已经走 SSE，
  // 所以这里的周期可以放宽到 10 秒。
  timer = setInterval(() => {
    if (!selectedKey.value || document.hidden) return
    void refreshAll(true)
  }, STATUS_INTERVAL_MS)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  timer = null
  closeStream()
})
</script>

<template>
  <div class="page">
    <div class="page-heading">
      <h1 class="page-title">服务器管理</h1>
      <div class="heading-actions">
        <md-icon-button aria-label="刷新" title="刷新" :disabled="loading" @click="loadInstances">
          <md-icon>refresh</md-icon>
        </md-icon-button>
      </div>
    </div>

    <p v-if="loading" class="empty">正在读取面板信息…</p>

    <section v-else-if="!configured" class="card">
      <h2 class="card-title">尚未连接 MCSM 面板</h2>
      <p class="card-note">请在「站点设置」填写面板地址与 ApiKey；ApiKey 权限等同面板账户，请妥善保管。</p>
      <div class="form-actions">
        <md-filled-button @click="goToSettings">
          <md-icon slot="icon">settings</md-icon>
          去站点设置
        </md-filled-button>
      </div>
    </section>

    <template v-else>
      <section class="card">
        <div class="instance-bar">
          <md-outlined-select
            v-if="instances.length"
            class="instance-select"
            label="实例"
            :value="selectedKey"
            @change="onInstanceChange"
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

          <div v-if="panelUser" class="panel-meta">
            <span>面板账户 <strong>{{ panelUser.userName }}</strong>（{{ panelUser.permissionLabel }}）</span>
            <span class="mono">{{ panelBaseUrl }}</span>
          </div>
        </div>
      </section>

      <template v-if="current">
        <section class="card">
          <div class="card-heading">
            <h2 class="card-title">
              {{ current.nickname || current.instanceUuid }}
              <span class="badge" :class="statusClass(current.status)">{{ current.statusLabel }}</span>
            </h2>
            <md-icon-button
              aria-label="刷新状态"
              title="刷新状态"
              :disabled="detailLoading"
              @click="refreshAll()"
            >
              <md-icon>sync</md-icon>
            </md-icon-button>
          </div>

          <dl class="meta">
            <div><dt>在线玩家</dt><dd>{{ playersLabel(current) }}</dd></div>
            <div><dt>服务器版本</dt><dd>{{ current.version || '—' }}</dd></div>
            <div><dt>节点</dt><dd>{{ current.remarks || '—' }} <span class="mono">{{ current.hostIp }}</span></dd></div>
            <div><dt>Ping 延迟</dt><dd>{{ current.latency >= 0 ? current.latency + ' ms' : '—' }}</dd></div>
            <div><dt>最近启动</dt><dd>{{ formatDate(current.lastDatetime) }}</dd></div>
            <div><dt>到期时间</dt><dd>{{ current.endTime ? formatDate(current.endTime) : '无限期' }}</dd></div>
            <template v-if="detail">
              <div><dt>已运行</dt><dd>{{ formatDuration(detail.processInfo.elapsed) }}</dd></div>
              <div><dt>CPU / 内存</dt><dd>{{ formatCpu(detail.processInfo.cpu) }} · {{ formatBytes(detail.processInfo.memory) }}</dd></div>
              <div><dt>磁盘占用</dt><dd>{{ formatBytes(detail.storageUsage) }}{{ detail.storageLimit ? ' / ' + formatBytes(detail.storageLimit) : '' }}</dd></div>
              <div><dt>启动次数</dt><dd>{{ detail.started }}</dd></div>
              <div><dt>实例类型</dt><dd>{{ detail.type || '—' }} / {{ detail.processType || '—' }}</dd></div>
              <div><dt>自动启动 / 自动重启</dt><dd>{{ detail.autoStart ? '开' : '关' }} / {{ detail.autoRestart ? '开' : '关' }}</dd></div>
              <div class="meta-wide"><dt>工作目录</dt><dd class="mono">{{ detail.cwd || '—' }}</dd></div>
            </template>
          </dl>

          <h3 class="section-title">电源</h3>
          <p v-if="!canPower" class="card-note">当前账户没有「电源操作」权限，按钮已禁用。</p>
          <div class="form-actions">
            <md-filled-button :disabled="!canPower || powerPending || running" @click="requestPower('open')">
              <md-icon slot="icon">play_arrow</md-icon>
              启动
            </md-filled-button>
            <md-outlined-button :disabled="!canPower || powerPending || stopped" @click="requestPower('restart')">
              <md-icon slot="icon">restart_alt</md-icon>
              重启
            </md-outlined-button>
            <md-outlined-button :disabled="!canPower || powerPending || stopped" @click="requestPower('stop')">
              <md-icon slot="icon">stop</md-icon>
              停止
            </md-outlined-button>
            <md-text-button
              class="danger"
              :disabled="!canPower || powerPending || stopped"
              @click="requestPower('kill')"
            >
              <md-icon slot="icon">dangerous</md-icon>
              强制结束
            </md-text-button>
          </div>
        </section>

        <section class="card">
          <div class="card-heading">
            <h2 class="card-title">
              控制台
              <span class="live-badge" :class="`live-badge--${liveState}`">
                <span class="live-dot"></span>
                {{ liveMode ? (liveState === 'open' ? '实时' : liveState === 'connecting' ? '连接中' : '已断开') : '已暂停' }}
              </span>
            </h2>
            <div class="console-tools">
              <md-outlined-select class="size-select" label="历史长度" :value="String(logSizeChars)" @change="onLogSizeChange">
                <md-select-option
                  v-for="option in LOG_SIZE_OPTIONS"
                  :key="option.value"
                  :value="String(option.value)"
                  :selected="option.value === logSizeChars"
                >
                  <div slot="headline">{{ option.label }}</div>
                </md-select-option>
              </md-outlined-select>
              <label class="switch-row">
                <md-switch :selected="liveMode" @change="toggleLive"></md-switch>
                <span>实时输出</span>
              </label>
              <label class="switch-row">
                <md-checkbox :checked="autoScroll" @change="onAutoScrollChange"></md-checkbox>
                <span>自动滚到底部</span>
              </label>
              <md-icon-button
                v-if="!liveMode"
                aria-label="刷新输出"
                title="刷新输出"
                :disabled="logLoading"
                @click="loadLog()"
              >
                <md-icon>refresh</md-icon>
              </md-icon-button>
            </div>
          </div>

          <pre ref="consoleBox" class="console">{{ logText || (logLoading ? '加载中…' : liveMode && liveState !== 'closed' ? '正在连接实时控制台…' : '（暂无输出）') }}</pre>
          <h3 class="section-title">发送命令</h3>
          <p v-if="!canCommand" class="card-note">当前账户没有「发送命令」权限，输入框已禁用。</p>
          <div class="command-row">
            <md-outlined-text-field
              class="command-input"
              label="服务器命令"
              supporting-text="无需前置斜杠，一次一条命令"
              autocomplete="off"
              spellcheck="false"
              :disabled="!canCommand || !running"
              :value="command"
              @input="command = ($event.target as HTMLInputElement).value"
              @keydown="onCommandKeydown"
            ></md-outlined-text-field>
            <md-filled-button :disabled="!canCommand || !running || sending || !command.trim()" @click="sendCommand">
              {{ sending ? '发送中…' : '发送' }}
            </md-filled-button>
          </div>
          <p v-if="!running" class="card-note">实例未在运行，命令发送已禁用。</p>
          <div v-if="canCommand && running" class="quick-commands">
            <span class="quick-label">快捷填入：</span>
            <md-text-button v-for="item in QUICK_COMMANDS" :key="item" @click="command = item">{{ item }}</md-text-button>
          </div>
        </section>

        <section class="card">
          <div class="card-heading">
            <h2 class="card-title">备份</h2>
            <div class="heading-actions">
              <md-filled-button :disabled="!canBackup || backupsLoading" @click="openCreateBackup">
                <md-icon slot="icon">backup</md-icon>
                创建备份
              </md-filled-button>
              <md-icon-button aria-label="刷新备份" title="刷新备份" :disabled="backupsLoading" @click="loadBackups()">
                <md-icon>refresh</md-icon>
              </md-icon-button>
            </div>
          </div>

          <p class="card-note">
            大世界压缩可能先超时；任务仍会在面板侧继续。恢复会覆盖同名文件，只能在实例停止时执行。
            运行中被占用的文件无法压缩，整机备份前请停服。
          </p>
          <p v-if="!canBackup" class="card-note">当前账户没有「备份管理」权限，只能查看列表。</p>

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>备份文件</th>
                  <th>大小</th>
                  <th>修改时间</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="backup in backups" :key="backup.name">
                  <td class="primary-cell">{{ backup.name }}</td>
                  <td>{{ formatBytes(backup.size) }}</td>
                  <td>{{ backup.time || '—' }}</td>
                  <td class="cell-actions">
                    <md-text-button :disabled="!canBackup" @click="requestDownload(backup)">下载</md-text-button>
                    <md-text-button
                      :disabled="!canBackup || !stopped"
                      :title="stopped ? '解压覆盖实例目录' : '需要先停止实例'"
                      @click="restoreTarget = backup"
                    >恢复</md-text-button>
                    <md-icon-button
                      v-if="canBackup"
                      aria-label="删除备份"
                      title="删除备份"
                      @click="deleteTarget = backup"
                    >
                      <md-icon>delete</md-icon>
                    </md-icon-button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="backupsLoading" class="empty">加载中…</p>
            <p v-else-if="!backups.length" class="empty">{{ backupDir }} 下还没有备份压缩包</p>
          </div>
        </section>

        <ServerProperties
          v-if="propertiesLevel !== 'hidden'"
          :uuid="current.instanceUuid"
          :daemon-id="current.daemonId"
          :can-edit="canEditProperties"
        />

        <ServerSchedules
          v-if="scheduleLevel !== 'hidden'"
          :uuid="current.instanceUuid"
          :daemon-id="current.daemonId"
          :can-edit="canEditSchedule"
        />

      </template>
    </template>

    <md-dialog ref="createDialog" :open="createOpen" @closed="createOpen = false">
      <md-icon slot="icon">backup</md-icon>
      <div slot="headline">创建备份</div>
      <div slot="content" class="create-content">
        <p v-if="!selectableDirectories.length" class="empty">没有可备份的目录</p>
        <div v-else class="target-list">
          <label v-for="name in selectableDirectories" :key="name" class="switch-row">
            <md-checkbox
              :checked="createTargets.includes(name)"
              @change="toggleCreateTarget(name)"
            ></md-checkbox>
            <span class="mono">{{ name }}</span>
          </label>
        </div>
        <md-outlined-text-field
          class="label-input"
          label="备份标签（可选）"
          supporting-text="只能是字母、数字、点、下划线和短横线；最终文件名为 标签-时间戳.zip"
          autocomplete="off"
          spellcheck="false"
          :value="createLabel"
          @input="createLabel = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
      </div>
      <div slot="actions">
        <md-text-button :disabled="creating" @click="createOpen = false">取消</md-text-button>
        <md-text-button :disabled="creating || !createTargets.length" @click="submitCreateBackup">
          {{ creating ? '压缩中…' : '开始备份' }}
        </md-text-button>
      </div>
    </md-dialog>

    <md-dialog ref="downloadDialog" :open="!!downloadUrl" @closed="downloadUrl = ''">
      <md-icon slot="icon">download</md-icon>
      <div slot="headline">下载备份 {{ downloadName }}</div>
      <div slot="content" class="download-content">
        <p class="card-note">若节点地址为内网域名或浏览器拦截不安全下载，请改用面板文件管理。</p>
        <p class="mono download-url">{{ downloadUrl }}</p>
      </div>
      <div slot="actions">
        <md-text-button @click="copyDownloadUrl">复制地址</md-text-button>
        <a class="download-link" :href="downloadUrl" target="_blank" rel="noopener noreferrer">
          <md-text-button>打开下载</md-text-button>
        </a>
        <md-text-button @click="downloadUrl = ''">关闭</md-text-button>
      </div>
    </md-dialog>

    <ConfirmDialog
      :open="!!powerConfirm"
      :title="powerConfirm ? POWER_LABELS[powerConfirm] + '服务器' : ''"
      :message="powerConfirm ? POWER_CONFIRM[powerConfirm] : ''"
      :icon="powerConfirm === 'kill' ? 'dangerous' : 'power_settings_new'"
      :confirm-label="powerConfirm ? POWER_LABELS[powerConfirm] : '确认'"
      pending-label="提交中…"
      destructive
      :pending="powerPending"
      @confirm="powerConfirm && runPower(powerConfirm)"
      @cancel="powerConfirm = null"
      @closed="powerConfirm = null"
    >
      <div v-if="current" class="confirm-preview">
        <md-icon>dns</md-icon>
        <span>{{ current.nickname || current.instanceUuid }} · 在线 {{ playersLabel(current) }}</span>
      </div>
    </ConfirmDialog>

    <ConfirmDialog
      :open="!!restoreTarget"
      title="恢复备份"
      :message="`确定要用「${restoreTarget?.name}」覆盖实例目录吗？压缩包里的文件会覆盖同名文件，此操作无法撤销。`"
      icon="restore"
      confirm-label="恢复"
      pending-label="解压中…"
      destructive
      :pending="restorePending"
      @confirm="confirmRestore"
      @cancel="restoreTarget = null"
      @closed="restoreTarget = null"
    />

    <ConfirmDialog
      :open="!!deleteTarget"
      title="删除备份"
      :message="`确定要删除备份「${deleteTarget?.name}」吗？删除后无法恢复。`"
      icon="delete"
      confirm-label="删除"
      pending-label="删除中…"
      destructive
      :pending="deletePending"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
      @closed="deleteTarget = null"
    />
  </div>
</template>

<style scoped>
.page-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.heading-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.card + .card { margin-top: 20px; }
.card-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.card-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.card-note { margin: 8px 0 0; font-size: 13px; line-height: 1.7; color: var(--md-sys-color-on-surface-variant); }
.card-note code { padding: 1px 5px; border-radius: 4px; background: var(--md-sys-color-surface); font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.section-title { margin: 22px 0 10px; font-size: 13px; font-weight: 600; color: var(--md-sys-color-on-surface-variant); }
.instance-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.instance-select { min-width: 280px; flex: 1 1 280px; }
.size-select { min-width: 160px; }
.panel-meta { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--md-sys-color-on-surface-variant); text-align: right; }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px 20px; margin: 18px 0 0; }
.meta-wide { grid-column: 1 / -1; }
.meta dt { color: var(--md-sys-color-on-surface-variant); font-size: 12px; }
.meta dd { margin: 2px 0 0; font-size: 14px; overflow-wrap: anywhere; }
.mono { font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; line-height: 18px; background: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); }
.badge-running { background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); }
.badge-stopped { background: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); }
.badge-busy, .badge-pending { background: var(--md-sys-color-tertiary-container); color: var(--md-sys-color-on-tertiary-container); }
.form-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 14px; }
.danger { color: var(--md-sys-color-error); }
.console-tools { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.live-badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 500; line-height: 18px; background: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); }
.live-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.live-badge--open { background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); }
.live-badge--open .live-dot { animation: live-pulse 1.6s ease-in-out infinite; }
.live-badge--connecting { background: var(--md-sys-color-tertiary-container); color: var(--md-sys-color-on-tertiary-container); }

@keyframes live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}

@media (prefers-reduced-motion: reduce) {
  .live-badge--open .live-dot { animation: none; }
}
.switch-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--md-sys-color-on-surface-variant); cursor: pointer; }
.console { margin: 16px 0 0; padding: 14px; border-radius: 8px; background: var(--md-sys-color-surface); color: var(--md-sys-color-on-surface); height: 420px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.6; }
.command-row { display: flex; align-items: flex-start; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
.command-input { flex: 1 1 360px; min-width: 0; }
.quick-commands { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.quick-label { font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.table-wrap { overflow-x: auto; margin-top: 16px; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 12px 10px; border-bottom: 1px solid var(--md-sys-color-outline-variant); text-align: left; white-space: nowrap; }
.data-table th { color: var(--md-sys-color-on-surface-variant); font-size: 12px; font-weight: 500; }
.primary-cell { font-weight: 600; font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.cell-actions { text-align: right; white-space: nowrap; }
.empty { padding: 16px 0; color: var(--md-sys-color-on-surface-variant); font-size: 14px; }
.create-content, .download-content { min-width: min(460px, calc(100vw - 72px)); }
.target-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 6px 16px; margin: 14px 0; }
.label-input { width: 100%; margin-top: 8px; }
.download-url { margin: 12px 0 0; padding: 10px 12px; border-radius: 8px; background: var(--md-sys-color-surface-variant); overflow-wrap: anywhere; }
.download-link { text-decoration: none; }
.confirm-preview { display: flex; align-items: center; gap: 8px; font-size: 14px; overflow-wrap: anywhere; }

@media (max-width: 720px) {
  .page-heading { align-items: stretch; flex-direction: column; }
  .heading-actions { width: 100%; justify-content: flex-end; flex-wrap: wrap; }
  .panel-meta { text-align: left; }
  .console { height: 320px; }
  .instance-select { min-width: 0; flex-basis: 100%; }
  .size-select { width: 100%; min-width: 0; }
  .create-content,
  .download-content { width: 100%; min-width: 0; }
  .command-row md-filled-button { width: 100%; }
}
</style>
