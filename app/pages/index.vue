<script setup lang="ts">
import { ref, onMounted } from 'vue'

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

const navLinks = [
  { label: '服务器动态', icon: 'monitoring', to: '/activity' },
  { label: '管理游戏账户', icon: 'manage_accounts', to: '/game-accounts' },
  { label: '查看捐赠列表', icon: 'redeem', to: '/donors' },
]

const activeBans = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  return bans.value.filter((ban) => ban.unbanTime === 'permanent' || ban.unbanTime >= today).length
})

const donationTotal = computed(() => donors.value.reduce((sum, donor) => sum + (Number(donor.amount) || 0), 0))

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
      $fetch<ActivityRecord[]>('/api/activities'),
      $fetch<BanRecord[]>('/api/bans'),
      $fetch<DonorRecord[]>('/api/donors'),
      $fetch<UpdateRecord[]>('/api/updates'),
      $fetch<GameAccountRecord[]>('/api/admin/game-accounts'),
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
          <p class="dashboard-subtitle">服务器管理概览</p>
        </div>
        <md-icon-button aria-label="刷新仪表盘" title="刷新仪表盘" :disabled="refreshing" @click="loadDashboard">
          <md-icon :class="{ 'refresh-icon--loading': refreshing }">refresh</md-icon>
        </md-icon-button>
      </div>

      <div class="stat-grid dashboard-stats">
        <NuxtLink to="/game-accounts" class="card stat-card dashboard-stat-link">
          <span class="stat-icon"><md-icon>manage_accounts</md-icon></span>
          <span><strong class="stat-value">{{ loading ? '—' : gameAccounts.length }}</strong><span class="stat-label">游戏账户</span></span>
        </NuxtLink>
        <NuxtLink to="/activity" class="card stat-card dashboard-stat-link">
          <span class="stat-icon"><md-icon>monitoring</md-icon></span>
          <span><strong class="stat-value">{{ loading ? '—' : activities.length }}</strong><span class="stat-label">动态数量</span></span>
        </NuxtLink>
        <NuxtLink to="/bans" class="card stat-card dashboard-stat-link">
          <span class="stat-icon stat-icon--warning"><md-icon>gavel</md-icon></span>
          <span><strong class="stat-value">{{ loading ? '—' : activeBans }}</strong><span class="stat-label">当前封禁</span></span>
        </NuxtLink>
        <NuxtLink to="/donors" class="card stat-card dashboard-stat-link">
          <span class="stat-icon stat-icon--success"><md-icon>volunteer_activism</md-icon></span>
          <span><strong class="stat-value">{{ loading ? '—' : formatAmount(donationTotal) }}</strong><span class="stat-label">累计捐赠</span></span>
        </NuxtLink>
      </div>

      <div class="dashboard-grid">
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
            <NuxtLink to="/activity" class="section-link">查看全部</NuxtLink>
          </div>
          <div v-if="loading" class="empty">加载中…</div>
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
          <NuxtLink to="/updates" class="section-link">管理更新</NuxtLink>
        </div>
        <div v-if="loading" class="empty">加载中…</div>
        <div v-else-if="updates.length" class="update-summary-list">
          <NuxtLink v-for="update in updates.slice(0, 3)" :key="update.id" to="/updates" class="update-summary-item">
            <span class="update-summary-icon"><md-icon>system_update</md-icon></span>
            <span><strong>{{ update.name }}</strong><span>最新版本 {{ update.latestVersion }}<em v-if="update.forcedUpdate">强制更新</em></span></span>
          </NuxtLink>
        </div>
        <p v-else class="empty">暂无更新程序</p>
      </section>

      <nav class="dashboard-links" aria-label="常用管理入口">
        <NuxtLink v-for="link in navLinks" :key="link.to" :to="link.to" class="dashboard-link">
          <md-icon>{{ link.icon }}</md-icon>
          <span>{{ link.label }}</span>
          <md-icon class="dashboard-link-arrow">arrow_forward</md-icon>
        </NuxtLink>
      </nav>
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

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-bottom: 20px;
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

.dashboard-links {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.dashboard-link {
  padding: 14px 16px;
  border: 1px solid var(--md-sys-color-outline-variant);
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
  .dashboard-grid,
  .dashboard-links {
    grid-template-columns: 1fr;
  }

  .dashboard-card {
    padding: 16px;
  }
}
</style>
