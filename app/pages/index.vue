<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'

definePageMeta({ layout: false })

const { data: setupState } = await useFetch<{ initialized: boolean }>('/api/auth/setup')
const setupRequired = computed(() => setupState.value?.initialized === false)
useHead({ title: computed(() => setupRequired.value ? '初始化后台' : '仪表盘') })

interface LoginRecord {
  ip: string
  time: number
  username: string
  browser: string
  os: string
  device: string
}

interface ActivityRecord {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  date: string
  content: string
}

interface BanRecord {
  id: string
  player: string
  unbanTime: string
}

interface DonorRecord {
  id: string
  amount: number
}

interface UpdateRecord {
  id: string
  name: string
  latestVersion: string
  forcedUpdate: boolean
}

interface GameAccountRecord {
  username: string
  registered: boolean
}

const logins = ref<LoginRecord[]>([])
const activities = ref<ActivityRecord[]>([])
const bans = ref<BanRecord[]>([])
const donors = ref<DonorRecord[]>([])
const updates = ref<UpdateRecord[]>([])
const gameAccounts = ref<GameAccountRecord[]>([])
const loading = ref(true)
const refreshing = ref(false)
const { showToast } = useToast()
const access = useAdminAccess()

const navLinks = computed(() => [
  { key: 'activity', label: '服务器动态', icon: 'monitoring', to: '/activity' },
  { key: 'chat', label: '管理聊天区', icon: 'forum', to: '/chat' },
  { key: 'game-accounts', label: '管理游戏账户', icon: 'manage_accounts', to: '/game-accounts' },
  { key: 'donors', label: '查看捐赠列表', icon: 'redeem', to: '/donors' },
].filter((link) => canView(link.key)))

function canView(key: string) {
  return access.levelForKey(key) !== 'hidden'
}

function isRestricted(key: string) {
  return !canView(key)
}

const activeBans = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  return bans.value.filter((ban) => ban.unbanTime === 'permanent' || ban.unbanTime >= today).length
})

const donationTotal = computed(() => donors.value.reduce((sum, donor) => sum + (Number(donor.amount) || 0), 0))
const todayLoginCount = computed(() => {
  const now = new Date()
  return logins.value.filter((login) => {
    const date = new Date(login.time)
    return date.toDateString() === now.toDateString()
  }).length
})
const uniqueLoginIps = computed(() => new Set(logins.value.map((login) => login.ip).filter(Boolean)).size)
const uniqueLoginDevices = computed(() => new Set(logins.value
  .map((login) => [login.browser, login.os, login.device].filter(Boolean).join('|'))
  .filter(Boolean)).size)
const lastLoginTime = computed(() => logins.value[0]?.time || 0)
const lastLoginLabel = computed(() => lastLoginTime.value ? `最近登录于 ${formatTime(lastLoginTime.value)}` : '暂无登录记录')
const activityOverviewItems = computed(() => {
  const definitions = [
    { type: 'info' as const, label: '信息', icon: 'info' },
    { type: 'success' as const, label: '完成', icon: 'check_circle' },
    { type: 'warning' as const, label: '警报', icon: 'warning' },
    { type: 'error' as const, label: '错误', icon: 'error' },
  ]
  return definitions.map((item) => {
    const count = activities.value.filter((activity) => activity.type === item.type).length
    return {
      ...item,
      count,
      percentage: activities.value.length ? (count / activities.value.length) * 100 : 0,
    }
  })
})
const activityHealth = computed(() => {
  const errors = activityOverviewItems.value.find((item) => item.type === 'error')?.count || 0
  const warnings = activityOverviewItems.value.find((item) => item.type === 'warning')?.count || 0
  if (errors) return { label: `${errors} 条错误`, tone: 'error' }
  if (warnings) return { label: `${warnings} 条警报`, tone: 'warning' }
  if (activities.value.length) return { label: '状态正常', tone: 'normal' }
  return { label: '暂无动态', tone: 'neutral' }
})

function activityLabel(type: ActivityRecord['type']) {
  return ({ info: '信息', success: '完成', warning: '警报', error: '错误' })[type]
}

function formatAmount(value: number) {
  return `¥${value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}`
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN')
}

async function loadDashboard() {
  refreshing.value = true
  try {
    const results = await Promise.allSettled([
      $fetch<LoginRecord[]>('/api/auth/logins'),
      canView('activity') ? $fetch<ActivityRecord[]>('/api/activities') : Promise.resolve([]),
      canView('bans') ? $fetch<BanRecord[]>('/api/bans') : Promise.resolve([]),
      canView('donors') ? $fetch<DonorRecord[]>('/api/donors') : Promise.resolve([]),
      canView('updates') ? $fetch<UpdateRecord[]>('/api/updates') : Promise.resolve([]),
      canView('game-accounts') ? $fetch<GameAccountRecord[]>('/api/admin/game-accounts') : Promise.resolve([]),
    ])
    const [loginResult, activityResult, banResult, donorResult, updateResult, accountResult] = results
    if (loginResult.status === 'fulfilled') logins.value = loginResult.value
    if (activityResult.status === 'fulfilled') activities.value = activityResult.value
    if (banResult.status === 'fulfilled') bans.value = banResult.value
    if (donorResult.status === 'fulfilled') donors.value = donorResult.value
    if (updateResult.status === 'fulfilled') updates.value = updateResult.value
    if (accountResult.status === 'fulfilled') gameAccounts.value = accountResult.value
    if (results.some((result) => result.status === 'rejected')) {
      showToast('部分仪表盘数据加载失败', 'error')
    }
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

onMounted(async () => {
  if (setupRequired.value) {
    loading.value = false
    return
  }
  await access.load().catch(() => null)
  await loadDashboard()
})

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN')
}

function formatLoginClient(login: LoginRecord) {
  const details = [login.browser, login.os, login.device].filter(Boolean)
  return details.length ? details.join(' · ') : '未知设备'
}
</script>

<template>
  <AdminSetup v-if="setupRequired" />
  <NuxtLayout v-else name="default">
    <div class="page">
      <div class="dashboard-heading">
        <div>
          <h1 class="page-title">仪表盘</h1>
          <p class="dashboard-subtitle">账户、访问与服务状态总览</p>
        </div>
        <md-icon-button aria-label="刷新仪表盘" title="刷新仪表盘" :disabled="refreshing" @click="loadDashboard">
          <md-icon :class="{ 'refresh-icon--loading': refreshing }">refresh</md-icon>
        </md-icon-button>
      </div>

      <div class="stat-grid dashboard-stats">
        <template v-if="canView('game-accounts')">
          <NuxtLink to="/game-accounts" class="card stat-card dashboard-stat-link">
            <span class="stat-icon"><md-icon>manage_accounts</md-icon></span>
            <span><strong class="stat-value">{{ loading ? '—' : gameAccounts.length }}</strong><span class="stat-label">游戏账户</span></span>
          </NuxtLink>
        </template>
        <div v-else class="card stat-card dashboard-stat-restricted">
          <DashboardPermissionPlaceholder compact label="游戏账户" />
        </div>
        <template v-if="canView('bans')">
          <NuxtLink to="/bans" class="card stat-card dashboard-stat-link">
            <span class="stat-icon stat-icon--warning"><md-icon>gavel</md-icon></span>
            <span><strong class="stat-value">{{ loading ? '—' : activeBans }}</strong><span class="stat-label">当前封禁</span></span>
          </NuxtLink>
        </template>
        <div v-else class="card stat-card dashboard-stat-restricted">
          <DashboardPermissionPlaceholder compact label="当前封禁" />
        </div>
        <template v-if="canView('donors')">
          <NuxtLink to="/donors" class="card stat-card dashboard-stat-link">
            <span class="stat-icon stat-icon--success"><md-icon>volunteer_activism</md-icon></span>
            <span><strong class="stat-value">{{ loading ? '—' : formatAmount(donationTotal) }}</strong><span class="stat-label">累计捐赠</span></span>
          </NuxtLink>
        </template>
        <div v-else class="card stat-card dashboard-stat-restricted">
          <DashboardPermissionPlaceholder compact label="累计捐赠" />
        </div>
        <template v-if="canView('updates')">
          <NuxtLink to="/updates" class="card stat-card dashboard-stat-link">
            <span class="stat-icon stat-icon--update"><md-icon>system_update</md-icon></span>
            <span><strong class="stat-value">{{ loading ? '—' : updates.length }}</strong><span class="stat-label">更新程序</span></span>
          </NuxtLink>
        </template>
        <div v-else class="card stat-card dashboard-stat-restricted">
          <DashboardPermissionPlaceholder compact label="更新程序" />
        </div>
      </div>

      <div class="dashboard-overview-grid">
        <section class="card dashboard-card activity-overview">
          <div class="section-heading">
            <div>
              <h2 class="card-title">动态概况</h2>
              <p class="section-meta">最近服务器动态的类型分布</p>
            </div>
            <NuxtLink v-if="canView('activity')" to="/activity" class="section-link">查看全部</NuxtLink>
          </div>
          <DashboardPermissionPlaceholder v-if="isRestricted('activity')" />
          <div v-else-if="loading" class="empty">加载中…</div>
          <template v-else>
            <div class="activity-overview-total">
              <span><strong>{{ activities.length }}</strong><small>动态总数</small></span>
              <span class="activity-health" :class="`activity-health--${activityHealth.tone}`">
                <md-icon>{{ activityHealth.tone === 'normal' ? 'check_circle' : activityHealth.tone === 'error' ? 'error' : activityHealth.tone === 'warning' ? 'warning' : 'info' }}</md-icon>
                {{ activityHealth.label }}
              </span>
            </div>
            <div class="activity-overview-bar" role="img" aria-label="服务器动态类型分布">
              <span
                v-for="item in activityOverviewItems"
                :key="item.type"
                :class="`activity-bar--${item.type}`"
                :style="{ width: `${item.percentage}%` }"
              ></span>
            </div>
            <div class="activity-overview-legend">
              <span v-for="item in activityOverviewItems" :key="item.type">
                <i :class="`activity-legend-dot activity-legend-dot--${item.type}`"></i>
                <small>{{ item.label }}</small>
                <strong>{{ item.count }}</strong>
              </span>
            </div>
          </template>
        </section>

        <section class="card dashboard-card access-overview">
          <div class="section-heading">
            <div>
              <h2 class="card-title">访问概况</h2>
              <p class="section-meta">基于最近 {{ logins.length }} 条后台登录记录</p>
            </div>
            <md-icon class="section-heading-icon">devices</md-icon>
          </div>
          <div v-if="loading" class="empty">加载中…</div>
          <template v-else>
            <div class="access-metrics">
              <span><strong>{{ todayLoginCount }}</strong><small>今日登录</small></span>
              <span><strong>{{ uniqueLoginIps }}</strong><small>独立 IP</small></span>
              <span><strong>{{ uniqueLoginDevices }}</strong><small>独立设备</small></span>
            </div>
            <p class="last-access-time">
              <md-icon>schedule</md-icon>
              {{ lastLoginLabel }}
            </p>
          </template>
        </section>

      </div>

      <div class="dashboard-detail-grid">
        <section class="card dashboard-card">
          <div class="section-heading">
            <h2 class="card-title">最近登录 IP</h2>
            <span class="section-meta">最近 {{ logins.length }} 条</span>
          </div>
          <md-list>
            <md-list-item v-for="(l, i) in logins.slice(0, 5)" :key="i">
              <md-icon slot="start">devices</md-icon>
              <span slot="headline">{{ l.ip }}</span>
              <span slot="supporting-text" class="login-record-meta">
                <span v-if="l.username">{{ l.username }}</span>
                <span>{{ formatLoginClient(l) }}</span>
                <span>{{ formatTime(l.time) }}</span>
              </span>
            </md-list-item>
          </md-list>
          <p v-if="!loading && logins.length === 0" class="empty">暂无登录记录</p>
        </section>

        <section class="card dashboard-card">
          <div class="section-heading">
            <h2 class="card-title">最近服务器动态</h2>
            <NuxtLink v-if="canView('activity')" to="/activity" class="section-link">查看全部</NuxtLink>
          </div>
          <DashboardPermissionPlaceholder v-if="isRestricted('activity')" />
          <div v-else-if="loading" class="empty">加载中…</div>
          <div v-else-if="activities.length" class="activity-summary-list">
            <NuxtLink v-for="activity in activities.slice(0, 4)" :key="activity.id" to="/activity" class="activity-summary-item">
              <span class="activity-summary-marker" :class="`marker--${activity.type}`"></span>
              <span class="activity-summary-main"><strong>{{ activity.content }}</strong><span>{{ formatDate(activity.date) }} · {{ activityLabel(activity.type) }}</span></span>
            </NuxtLink>
          </div>
          <p v-else class="empty">暂无服务器动态</p>
        </section>
      </div>

      <section class="card dashboard-updates">
        <div class="section-heading">
          <h2 class="card-title">更新服务</h2>
          <NuxtLink v-if="canView('updates')" to="/updates" class="section-link">管理更新</NuxtLink>
        </div>
        <DashboardPermissionPlaceholder v-if="isRestricted('updates')" />
        <div v-else-if="loading" class="empty">加载中…</div>
        <div v-else-if="updates.length" class="update-summary-list">
          <NuxtLink v-for="update in updates.slice(0, 3)" :key="update.id" to="/updates" class="update-summary-item">
            <span class="update-summary-icon"><md-icon>system_update</md-icon></span>
            <span><strong>{{ update.name }}</strong><span>最新版本 {{ update.latestVersion }}<em v-if="update.forcedUpdate">强制更新</em></span></span>
          </NuxtLink>
        </div>
        <p v-else class="empty">暂无更新程序</p>
      </section>

      <section v-if="navLinks.length" class="dashboard-shortcuts">
        <div class="section-heading">
          <div>
            <h2 class="card-title">常用管理入口</h2>
            <p class="section-meta">快速前往常用功能</p>
          </div>
        </div>
        <nav class="dashboard-links" aria-label="常用管理入口">
          <NuxtLink v-for="link in navLinks" :key="link.to" :to="link.to" class="dashboard-link">
            <md-icon>{{ link.icon }}</md-icon>
            <span>{{ link.label }}</span>
            <md-icon class="dashboard-link-arrow">arrow_forward</md-icon>
          </NuxtLink>
        </nav>
      </section>
    </div>
  </NuxtLayout>
</template>

<style scoped>
md-list {
  --md-list-container-color: transparent;
}

.dashboard-card {
  min-width: 0;
}

.login-record-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
}

.dashboard-heading,
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dashboard-heading {
  margin-bottom: 20px;
}

.dashboard-heading .page-title,
.section-heading .card-title {
  margin: 0;
}

.dashboard-subtitle,
.section-meta {
  margin: 4px 0 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
}

.dashboard-stats {
  margin-bottom: 20px;
}

.dashboard-stat-link {
  color: inherit;
  text-decoration: none;
  transition: transform 180ms cubic-bezier(0.2, 0, 0, 1), box-shadow 180ms ease;
}

.dashboard-stat-restricted {
  padding: 10px 14px;
}

.dashboard-stat-restricted .dashboard-permission-placeholder {
  width: 100%;
}

.dashboard-stat-link:hover,
.dashboard-link:hover,
.activity-summary-item:hover,
.update-summary-item:hover {
  transform: translateY(-2px);
}

.stat-icon--warning {
  background: color-mix(in srgb, var(--act-warning) 18%, var(--md-sys-color-surface-container));
  color: var(--act-warning);
}

.stat-icon--success {
  background: color-mix(in srgb, var(--act-success) 18%, var(--md-sys-color-surface-container));
  color: var(--act-success);
}

.stat-icon--update {
  background: color-mix(in srgb, var(--md-sys-color-primary) 16%, var(--md-sys-color-surface-container));
  color: var(--md-sys-color-primary);
}

.dashboard-overview-grid,
.dashboard-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.dashboard-overview-grid {
  align-items: stretch;
}

.dashboard-detail-grid {
  align-items: start;
}

.activity-overview-total {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 20px;
}

.activity-overview-total > span:first-child {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.activity-overview-total > span:first-child strong {
  font-size: 32px;
  line-height: 1;
  font-weight: 600;
}

.activity-overview-total small,
.activity-overview-legend small,
.access-metrics small {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}

.activity-health {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--md-sys-color-surface-container-highest);
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.activity-health md-icon {
  --md-icon-size: 16px;
}

.activity-health--normal {
  background: color-mix(in srgb, var(--act-success) 14%, var(--md-sys-color-surface-container));
  color: var(--act-success);
}

.activity-health--warning {
  background: color-mix(in srgb, var(--act-warning) 14%, var(--md-sys-color-surface-container));
  color: var(--act-warning);
}

.activity-health--error {
  background: color-mix(in srgb, var(--act-error) 14%, var(--md-sys-color-surface-container));
  color: var(--act-error);
}

.activity-overview-bar {
  display: flex;
  height: 8px;
  margin: 16px 0 20px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--md-sys-color-surface-container-highest);
}

.activity-overview-bar span {
  height: 100%;
  transition: width 320ms cubic-bezier(0.2, 0, 0, 1);
}

.activity-bar--info { background: var(--act-info); }
.activity-bar--success { background: var(--act-success); }
.activity-bar--warning { background: var(--act-warning); }
.activity-bar--error { background: var(--act-error); }

.activity-overview-legend {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.activity-overview-legend span {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 3px 6px;
  min-width: 0;
}

.activity-overview-legend strong {
  grid-column: 2;
  font-size: 18px;
  line-height: 1;
}

.activity-legend-dot {
  width: 8px;
  height: 8px;
  grid-row: span 2;
  border-radius: 50%;
}

.activity-legend-dot--info { background: var(--act-info); }
.activity-legend-dot--success { background: var(--act-success); }
.activity-legend-dot--warning { background: var(--act-warning); }
.activity-legend-dot--error { background: var(--act-error); }

.access-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.section-heading-icon {
  color: var(--md-sys-color-primary);
  --md-icon-size: 24px;
}

.access-metrics {
  margin-top: 20px;
}

.access-metrics span {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.access-metrics strong {
  font-size: 24px;
  line-height: 1;
  font-weight: 600;
}

.last-access-time {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 22px 0 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}

.last-access-time md-icon {
  --md-icon-size: 16px;
}

.section-link {
  color: var(--md-sys-color-primary);
  font-size: 13px;
  text-decoration: none;
}

.section-link:hover {
  text-decoration: underline;
}

.activity-summary-list,
.update-summary-list {
  display: grid;
  gap: 4px;
  margin-top: 12px;
}

.activity-summary-item,
.update-summary-item,
.dashboard-link {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
  transition: transform 180ms cubic-bezier(0.2, 0, 0, 1), background-color 160ms ease;
}

.activity-summary-item,
.update-summary-item {
  padding: 10px 8px;
  border-radius: 8px;
}

.activity-summary-item:hover,
.update-summary-item:hover {
  background: var(--md-sys-color-surface);
}

.activity-summary-marker {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--act-info);
}

.marker--success { background: var(--act-success); }
.marker--warning { background: var(--act-warning); }
.marker--error { background: var(--act-error); }

.activity-summary-main,
.update-summary-item > span:last-child {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.activity-summary-main strong,
.update-summary-item strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-summary-main span,
.update-summary-item span span {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}

.update-summary-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  flex: 0 0 auto;
}

.update-summary-item em {
  margin-left: 8px;
  color: var(--act-error);
  font-style: normal;
}

.dashboard-updates {
  margin-bottom: 20px;
}

.dashboard-shortcuts {
  margin-bottom: 8px;
}

.dashboard-shortcuts .section-heading {
  margin-bottom: 12px;
}

.dashboard-links {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.dashboard-link {
  padding: 14px 16px;
  border-radius: 8px;
  background: var(--md-sys-color-surface-container);
}

.dashboard-link .dashboard-link-arrow {
  margin-left: auto;
  color: var(--md-sys-color-on-surface-variant);
  --md-icon-size: 18px;
}

.refresh-icon--loading {
  animation: dashboard-refresh-spin 800ms linear infinite;
}

@keyframes dashboard-refresh-spin {
  to { transform: rotate(360deg); }
}

.empty {
  margin: 0;
  padding: 16px 0;
  font-size: 14px;
  color: var(--md-sys-color-on-surface-variant);
}

@media (max-width: 480px) {
  .dashboard-overview-grid,
  .dashboard-detail-grid,
  .dashboard-links {
    grid-template-columns: 1fr;
  }

  .activity-overview-legend {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard-card {
    padding: 16px;
  }

  .access-metrics {
    gap: 8px;
  }

  .access-metrics strong {
    font-size: 20px;
  }
}

</style>
