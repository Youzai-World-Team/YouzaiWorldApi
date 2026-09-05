<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

useHead({ title: '服务器状态' })

interface StatusNode {
  nickname: string
  timestamp: number
  system: {
    type: string
    cpuUsage: number
    memUsage: number
  }
}

interface MinecraftStatus {
  online: boolean
  host: string
  port: number
  players?: { online: number; max: number }
  version?: string
  protocol?: number | string
  delay?: number
  error?: string
}

interface AvailabilityPoint {
  time: number
  status: 'online' | 'offline'
}

interface StatusSnapshot {
  generatedAt: number
  refreshAfterMs: number
  nodeName: string
  minecraftAddress: string
  node: StatusNode | null
  minecraft: MinecraftStatus | null
  history: AvailabilityPoint[]
  errors: Partial<Record<'node' | 'minecraft' | 'history' | 'storage' | 'worker', string>>
  stale?: boolean
}

const MAX_HISTORY_POINTS = 96
const DEFAULT_REFRESH_MS = 5 * 60 * 1000
const snapshot = ref<StatusSnapshot | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const requestError = ref('')
let refreshTimer: number | undefined
let disposed = false

const node = computed(() => snapshot.value?.node || null)
const minecraft = computed(() => snapshot.value?.minecraft || null)
const history = computed(() => snapshot.value?.history || [])
const emptyHistoryPoints = computed(() => Math.max(MAX_HISTORY_POINTS - history.value.length, 0))
const availability = computed(() => {
  if (!history.value.length) return null
  const online = history.value.filter((point) => point.status === 'online').length
  return (online / history.value.length) * 100
})
const availabilityTone = computed(() => {
  if (availability.value === null) return 'neutral'
  if (availability.value <= 20) return 'error'
  if (availability.value < 90) return 'warning'
  return 'success'
})
const cpuUsage = computed(() => usagePercent(node.value?.system.cpuUsage))
const memoryUsage = computed(() => usagePercent(node.value?.system.memUsage))
const lastUpdated = computed(() => snapshot.value ? formatTime(snapshot.value.generatedAt) : '尚未更新')
const hasAnyData = computed(() => Boolean(node.value || minecraft.value || history.value.length))

function usagePercent(value?: number): number {
  if (!Number.isFinite(value)) return 0
  const percent = Number(value) <= 1 ? Number(value) * 100 : Number(value)
  return Math.min(100, Math.max(0, percent))
}

function formatPercent(value: number | null): string {
  return value === null ? '-' : `${value.toFixed(1)}%`
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN')
}

function formatDelay(delay?: number): string {
  return Number.isFinite(delay) ? `${Math.round(Number(delay))} ms` : '-'
}

function delayTone(delay?: number): string {
  if (!Number.isFinite(delay)) return 'neutral'
  if (Number(delay) > 200) return 'error'
  if (Number(delay) > 100) return 'warning'
  return 'success'
}

function historyTitle(point: AvailabilityPoint): string {
  return `${formatTime(point.time)} · ${point.status === 'online' ? '在线' : '离线'}`
}

function scheduleRefresh(delay = snapshot.value?.refreshAfterMs || DEFAULT_REFRESH_MS) {
  if (disposed) return
  if (refreshTimer) window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(async () => {
    await loadStatus()
  }, Math.max(30_000, delay))
}

async function loadStatus() {
  if (refreshing.value) return
  refreshing.value = true
  requestError.value = ''
  try {
    snapshot.value = await $fetch<StatusSnapshot>('/api/admin/status')
  } catch (error: any) {
    requestError.value = error?.data?.statusMessage || error?.statusMessage || '状态数据加载失败'
  } finally {
    loading.value = false
    refreshing.value = false
    scheduleRefresh()
  }
}

onMounted(loadStatus)
onBeforeUnmount(() => {
  disposed = true
  if (refreshTimer) window.clearTimeout(refreshTimer)
})
</script>

<template>
  <div class="page page--wide status-page api-redesign-page">
    <div class="status-heading">
      <div>
        <h1 class="page-title">服务器状态</h1>
      </div>
      <div class="heading-actions">
        <span class="updated-at">{{ lastUpdated }}</span>
        <md-icon-button aria-label="刷新服务器状态" title="刷新服务器状态" :disabled="refreshing" @click="loadStatus">
          <md-icon :class="{ 'refresh-icon--loading': refreshing }">refresh</md-icon>
        </md-icon-button>
      </div>
    </div>

    <div v-if="loading" class="card status-loading" aria-live="polite">
      <md-circular-progress indeterminate></md-circular-progress>
      <span>正在获取服务器状态…</span>
    </div>

    <div v-else-if="requestError && !hasAnyData" class="card error-panel">
      <md-icon>cloud_off</md-icon>
      <div>
        <h2>状态加载失败</h2>
        <p>{{ requestError }}</p>
      </div>
      <md-filled-button :disabled="refreshing" @click="loadStatus">
        <md-icon slot="icon">refresh</md-icon>
        重新加载
      </md-filled-button>
    </div>

    <template v-else>
      <div v-if="snapshot?.stale" class="partial-warning" role="status">
        <md-icon>history</md-icon>
        <span>{{ snapshot.errors.worker || '状态 Worker 暂时不可用，当前显示最近一次成功数据。' }}</span>
      </div>
      <div v-if="requestError" class="partial-warning" role="status">
        <md-icon>warning</md-icon>
        <span>{{ requestError }}，当前显示上次成功获取的数据。</span>
      </div>

      <div class="details-section">
        <div class="stat-grid status-summary">
          <section class="card stat-card">
            <span class="stat-icon" :class="node ? 'tone-success' : 'tone-error'"><md-icon>dns</md-icon></span>
            <span>
              <strong class="stat-value">{{ node ? '在线' : '不可用' }}</strong>
              <span class="stat-label">{{ snapshot?.nodeName || 'EQAD-003' }}</span>
            </span>
          </section>
          <section class="card stat-card">
            <span class="stat-icon" :class="minecraft?.online ? 'tone-success' : 'tone-error'"><md-icon>sports_esports</md-icon></span>
            <span>
              <strong class="stat-value">{{ minecraft ? (minecraft.online ? '在线' : '离线') : '不可用' }}</strong>
              <span class="stat-label">{{ snapshot?.minecraftAddress || 'play.mcyzw.top:25565' }}</span>
            </span>
          </section>
          <section class="card stat-card">
            <span class="stat-icon" :class="`tone-${availabilityTone}`"><md-icon>monitor_heart</md-icon></span>
            <span>
              <strong class="stat-value">{{ formatPercent(availability) }}</strong>
              <span class="stat-label">24 小时在线率</span>
            </span>
          </section>
        </div>

        <section class="card details-card">
          <div class="section-heading">
            <h2 class="card-title">机器状态</h2>
            <span class="status-chip" :class="node ? 'status-chip--online' : 'status-chip--offline'">
              <i></i>{{ node ? '在线' : '不可用' }}
            </span>
          </div>

          <div v-if="node" class="machine-grid">
            <div class="metric-block">
              <div class="metric-label"><span>CPU 使用率</span><strong>{{ cpuUsage.toFixed(1) }}%</strong></div>
              <div class="metric-track" role="progressbar" aria-label="CPU 使用率" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="cpuUsage">
                <span :style="{ width: `${cpuUsage}%` }"></span>
              </div>
            </div>
            <div class="metric-block">
              <div class="metric-label"><span>内存使用率</span><strong>{{ memoryUsage.toFixed(1) }}%</strong></div>
              <div class="metric-track" role="progressbar" aria-label="内存使用率" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="memoryUsage">
                <span :style="{ width: `${memoryUsage}%` }"></span>
              </div>
            </div>
            <div class="info-row"><span>系统类型</span><strong>{{ node.system.type }}</strong></div>
            <div class="info-row"><span>更新时间</span><strong>{{ formatTime(node.timestamp) }}</strong></div>
          </div>
          <div v-else class="source-error">
            <md-icon>cloud_off</md-icon>
            <span>{{ snapshot?.errors.node || '节点监控数据暂不可用' }}</span>
          </div>

          <div class="section-divider"></div>

          <div class="section-heading game-heading">
            <h2 class="card-title">Minecraft 服务</h2>
            <span class="status-chip" :class="minecraft?.online ? 'status-chip--online' : 'status-chip--offline'">
              <i></i>{{ minecraft ? (minecraft.online ? '在线' : '离线') : '不可用' }}
            </span>
          </div>

          <div v-if="minecraft?.online" class="game-grid">
            <div class="info-tile"><md-icon>group</md-icon><span>在线玩家</span><strong>{{ minecraft.players?.online ?? 0 }} / {{ minecraft.players?.max ?? 0 }}</strong></div>
            <div class="info-tile"><md-icon>deployed_code</md-icon><span>游戏版本</span><strong>{{ minecraft.version || '未知' }}</strong></div>
            <div class="info-tile" :class="`delay-${delayTone(minecraft.delay)}`"><md-icon>speed</md-icon><span>连接延迟</span><strong>{{ formatDelay(minecraft.delay) }}</strong></div>
            <div class="info-tile"><md-icon>tag</md-icon><span>协议版本</span><strong>{{ minecraft.protocol ?? '-' }}</strong></div>
          </div>
          <div v-else class="source-error">
            <md-icon>sports_esports</md-icon>
            <span>{{ minecraft?.error || snapshot?.errors.minecraft || 'Minecraft 状态暂不可用' }}</span>
          </div>
        </section>
      </div>

      <section class="card history-card">
        <div class="section-heading">
          <h2 class="card-title">最近 24 小时</h2>
          <strong class="availability-value" :class="`availability-value--${availabilityTone}`">{{ formatPercent(availability) }}</strong>
        </div>

        <div v-if="history.length" class="history-chart" role="img" :aria-label="`最近 24 小时在线率 ${formatPercent(availability)}`">
          <span v-for="index in emptyHistoryPoints" :key="`empty-${index}`" class="history-segment history-segment--empty" title="无数据"></span>
          <span
            v-for="point in history"
            :key="`${point.time}-${point.status}`"
            class="history-segment"
            :class="point.status === 'online' ? 'history-segment--online' : 'history-segment--offline'"
            :title="historyTitle(point)"
          ></span>
        </div>
        <EmptyState v-else image="/images/empty-monitoring-data.svg">
          {{ snapshot?.errors.history || '暂无历史状态数据' }}
        </EmptyState>

        <div v-if="history.length" class="history-axis"><span>24 小时前</span><span>12 小时前</span><span>现在</span></div>
        <div v-if="history.length" class="history-legend">
          <span><i class="legend-online"></i>在线</span>
          <span><i class="legend-offline"></i>离线</span>
          <span><i class="legend-empty"></i>无数据</span>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.status-heading,
.section-heading,
.heading-actions,
.metric-label,
.history-axis,
.history-legend {
  display: flex;
  align-items: center;
}

.status-heading,
.section-heading {
  justify-content: space-between;
  gap: 16px;
}

.status-heading {
  margin-bottom: 16px;
}

.status-heading .page-title,
.section-heading .card-title {
  margin: 0;
}

.updated-at {
  margin: 4px 0 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
}

.heading-actions {
  gap: 6px;
  flex: 0 0 auto;
}

.status-loading,
.source-error,
.error-panel,
.partial-warning {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-loading {
  min-height: 180px;
  justify-content: center;
  color: var(--md-sys-color-on-surface-variant);
}

.error-panel {
  align-items: flex-start;
}

.error-panel > md-icon {
  --md-icon-size: 32px;
  color: var(--md-sys-color-error);
}

.error-panel h2,
.error-panel p {
  margin: 0;
}

.error-panel p {
  margin-top: 4px;
  color: var(--md-sys-color-on-surface-variant);
}

.error-panel md-filled-button {
  margin-left: auto;
  flex: 0 0 auto;
}

.partial-warning {
  margin-bottom: 16px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--act-warning) 40%, var(--md-sys-color-outline-variant));
  border-radius: 8px;
  color: var(--act-warning);
  background: color-mix(in srgb, var(--act-warning) 8%, var(--md-sys-color-surface));
  font-size: 14px;
}

.status-summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-bottom: 20px;
}

.status-summary .stat-card {
  min-height: 96px;
}

.stat-card > span:last-child {
  min-width: 0;
}

.stat-label {
  display: block;
  margin-top: 4px;
  overflow-wrap: anywhere;
}

.tone-success {
  background: color-mix(in srgb, var(--act-success) 18%, var(--md-sys-color-surface-container));
  color: var(--act-success);
}

.tone-warning {
  background: color-mix(in srgb, var(--act-warning) 18%, var(--md-sys-color-surface-container));
  color: var(--act-warning);
}

.tone-error {
  background: color-mix(in srgb, var(--act-error) 15%, var(--md-sys-color-surface-container));
  color: var(--act-error);
}

.tone-neutral {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
}

.details-card,
.history-card {
  margin-bottom: 20px;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.status-chip i,
.history-legend i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-chip--online {
  color: var(--act-success);
  background: color-mix(in srgb, var(--act-success) 12%, transparent);
}

.status-chip--offline {
  color: var(--act-error);
  background: color-mix(in srgb, var(--act-error) 10%, transparent);
}

.status-chip--online i,
.legend-online {
  background: var(--act-success);
}

.status-chip--offline i,
.legend-offline {
  background: var(--act-error);
}

.machine-grid,
.game-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 20px;
}

.metric-block,
.info-row,
.info-tile {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 8px;
}

.metric-label {
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
}

.metric-track {
  height: 8px;
  margin-top: 12px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--md-sys-color-surface-container-high);
}

.metric-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--md-sys-color-primary);
  transition: width 300ms cubic-bezier(0.2, 0, 0, 1);
}

.info-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-row span,
.info-tile span {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
}

.info-row strong,
.info-tile strong {
  overflow-wrap: anywhere;
}

.section-divider {
  height: 1px;
  margin: 24px 0;
  background: var(--md-sys-color-outline-variant);
}

.game-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.info-tile {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 10px;
  align-items: center;
}

.info-tile md-icon {
  grid-row: 1 / 3;
  color: var(--md-sys-color-primary);
}

.delay-success strong { color: var(--act-success); }
.delay-warning strong { color: var(--act-warning); }
.delay-error strong { color: var(--act-error); }

.source-error {
  min-height: 84px;
  margin-top: 20px;
  padding: 16px;
  border: 1px dashed var(--md-sys-color-outline-variant);
  border-radius: 8px;
  color: var(--md-sys-color-on-surface-variant);
}

.availability-value {
  font-size: 28px;
}

.availability-value--success { color: var(--act-success); }
.availability-value--warning { color: var(--act-warning); }
.availability-value--error { color: var(--act-error); }
.availability-value--neutral { color: var(--md-sys-color-on-surface-variant); }

.history-chart {
  display: grid;
  grid-template-columns: repeat(96, minmax(3px, 1fr));
  gap: 3px;
  height: 84px;
  margin-top: 28px;
}

.history-segment {
  min-width: 0;
  border-radius: 2px;
}

.history-segment--online { background: var(--act-success); }
.history-segment--offline { background: var(--act-error); }
.history-segment--empty { background: var(--md-sys-color-outline-variant); opacity: 0.55; }

.history-axis {
  justify-content: space-between;
  margin-top: 8px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}

.history-legend {
  justify-content: flex-end;
  gap: 16px;
  margin-top: 20px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
}

.history-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-empty { background: var(--md-sys-color-outline-variant); }

.refresh-icon--loading {
  animation: status-spin 800ms linear infinite;
}

@keyframes status-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .status-summary,
  .game-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .history-chart {
    gap: 2px;
  }
}

@media (max-width: 640px) {
  .status-heading,
  .section-heading,
  .error-panel {
    align-items: flex-start;
  }

  .updated-at {
    display: none;
  }

  .status-summary,
  .machine-grid,
  .game-grid {
    grid-template-columns: 1fr;
  }

  .error-panel {
    flex-wrap: wrap;
  }

  .error-panel md-filled-button {
    width: 100%;
    margin-left: 0;
  }

  .history-chart {
    grid-template-columns: repeat(48, minmax(3px, 1fr));
    height: 112px;
  }

  .history-legend {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}

@media (max-width: 480px) {
  .history-chart {
    grid-template-columns: repeat(48, minmax(2px, 1fr));
    gap: 1px;
  }
}
</style>
