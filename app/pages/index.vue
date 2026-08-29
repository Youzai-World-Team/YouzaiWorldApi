<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ADMIN_PAGE_DEFINITIONS, adminPageKeyForPath } from '#shared/admin-page-permissions'

definePageMeta({ layout: false })

const { data: setupState } = await useFetch<{ initialized: boolean }>('/api/auth/setup')
const setupRequired = computed(() => setupState.value?.initialized === false)
useHead({ title: computed(() => setupRequired.value ? '初始化后台' : '仪表盘') })

type ActivityType = 'info' | 'success' | 'warning' | 'error'
type Tone = ActivityType | 'neutral'

interface LoginRecord { ip: string; location: string; time: number; username: string; browser: string; os: string; device: string }
interface ActivityRecord { id: string; type: ActivityType; date: string; content: string }
interface BanRecord { id: string; player: string; banTime: string; unbanTime: string; reason: string }
interface DonorRecord { id: string; name: string; amount: number }
interface UpdateRecord { id: string; name: string; latestVersion: string; forcedUpdate: boolean; release_date: string; release_time: string }
interface DownloadRecord { id: string; type: '整合包' | '模组'; name: string; version: string; updatedAt: number }
interface GameAccountRecord { username: string; email: string | null; last_authenticated_date: string }
interface AuditLogRecord { id: number; username: string; action: string; method: string; path: string; time: number }
interface MailRecord { id: string; type: string; sender: string; title: string; createdTime: number; expired: boolean; hidden: boolean; recipientCount: number; readCount: number }
interface ChatRecord { id: string; name: string; content: string; role: 'guest' | 'player' | 'admin'; time: number }
interface AdminPresence {
  id: number
  username: string
  avatar: string
  fullName: string
  isOwner: boolean
  path: string
  lastSeenAt: number
  isCurrent: boolean
}
interface AvailabilityPoint { time: number; status: 'online' | 'offline' }
interface StatusSnapshot {
  generatedAt: number
  refreshAfterMs: number
  nodeName: string
  minecraftAddress: string
  node: { nickname: string; timestamp: number; system: { type: string; cpuUsage: number; memUsage: number } } | null
  minecraft: { online: boolean; host: string; port: number; players?: { online: number; max: number }; version?: string; delay?: number; error?: string } | null
  history: AvailabilityPoint[]
  errors: Partial<Record<'node' | 'minecraft' | 'history', string>>
}
interface Metric { key: string; label: string; value: string; detail: string; icon: string; tone: Tone; to: string }
interface AttentionItem { key: string; title: string; detail: string; icon: string; tone: Tone; to?: string }
interface TimelineEvent { id: string; title: string; detail: string; time: number; icon: string; tone: Tone; to?: string }
interface ReleaseItem { id: string; name: string; meta: string; time: number; icon: string; tone: Tone; to: string; tag: string }
interface HealthMeter { key: string; label: string; value: number; display: string; tone: Tone }
interface DashboardJob { label: string; run: () => Promise<unknown>; apply: (value: any) => void }

const logins = ref<LoginRecord[]>([])
const activities = ref<ActivityRecord[]>([])
const bans = ref<BanRecord[]>([])
const donors = ref<DonorRecord[]>([])
const updates = ref<UpdateRecord[]>([])
const downloads = ref<DownloadRecord[]>([])
const gameAccounts = ref<GameAccountRecord[]>([])
const auditLogs = ref<AuditLogRecord[]>([])
const mails = ref<MailRecord[]>([])
const chatMessages = ref<ChatRecord[]>([])
const onlineAdmins = ref<AdminPresence[]>([])
const statusSnapshot = ref<StatusSnapshot | null>(null)
const statusError = ref('')
const loading = ref(true)
const refreshing = ref(false)
const statusLoading = ref(false)
const lastRefreshedAt = ref(0)
const { showToast } = useToast()
const access = useAdminAccess()
const domainMailUnread = useDomainMailUnread()
let presenceRefreshTimer: ReturnType<typeof setInterval> | undefined
let presenceHeartbeatTimer: ReturnType<typeof setInterval> | undefined

function canView(key: string) { return access.levelForKey(key) !== 'hidden' }
function normalizeTimestamp(value: number | string | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? (value > 0 && value < 1_000_000_000_000 ? value * 1000 : value) : 0
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}
function usagePercent(value?: number) {
  if (!Number.isFinite(value)) return 0
  const percent = Number(value) <= 1 ? Number(value) * 100 : Number(value)
  return Math.min(100, Math.max(0, percent))
}
function formatAmount(value: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)
}
function formatTime(value: number) {
  if (!value) return '暂无记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN')
}
function formatRelativeTime(value: number) {
  if (!value) return '时间未知'
  const diff = Date.now() - value
  if (diff < 0) return formatTime(value)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(value).toLocaleDateString('zh-CN')
}
function formatClient(login: LoginRecord) { return [login.browser, login.os, login.device].filter(Boolean).join(' · ') || '未知设备' }
function presencePageLabel(path: string) {
  if (path === '/account') return '账户设置'
  const key = adminPageKeyForPath(path)
  return ADMIN_PAGE_DEFINITIONS.find((page) => page.key === key)?.label || '后台页面'
}
function activityLabel(type: ActivityType) { return ({ info: '信息', success: '完成', warning: '警报', error: '错误' })[type] }
function isBanActive(ban: BanRecord) { return ban.unbanTime === 'permanent' || normalizeTimestamp(ban.unbanTime) > Date.now() }
function sameLocalDay(value: number) {
  const date = new Date(value)
  const now = new Date()
  return value > 0 && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}

const currentUserRole = computed(() => access.user.value?.isOwner ? '所有者' : '管理员')
const activeBans = computed(() => bans.value.filter(isBanActive))
const permanentBans = computed(() => activeBans.value.filter((ban) => ban.unbanTime === 'permanent').length)
const donationTotal = computed(() => donors.value.reduce((sum, donor) => sum + (Number(donor.amount) || 0), 0))
const forcedUpdates = computed(() => updates.value.filter((update) => update.forcedUpdate))
const activeMails = computed(() => mails.value.filter((mail) => !mail.expired && !mail.hidden))
const unreadMailDeliveries = computed(() => mails.value.reduce((sum, mail) => sum + Math.max(0, Number(mail.recipientCount || 0) - Number(mail.readCount || 0)), 0))
const mailRecipientTotal = computed(() => mails.value.reduce((sum, mail) => sum + Number(mail.recipientCount || 0), 0))
const mailReadTotal = computed(() => mails.value.reduce((sum, mail) => sum + Number(mail.readCount || 0), 0))
const mailReadRate = computed(() => mailRecipientTotal.value ? mailReadTotal.value / mailRecipientTotal.value * 100 : 0)
const accountsWithEmail = computed(() => gameAccounts.value.filter((account) => Boolean(account.email)).length)
const todayLoginCount = computed(() => logins.value.filter((login) => sameLocalDay(login.time)).length)
const todayAuditCount = computed(() => auditLogs.value.filter((log) => sameLocalDay(log.time)).length)
const uniqueLoginIps = computed(() => new Set(logins.value.map((login) => login.ip).filter(Boolean)).size)

const activityOverviewItems = computed(() => [
  { type: 'info' as const, label: '信息', icon: 'info' },
  { type: 'success' as const, label: '完成', icon: 'check_circle' },
  { type: 'warning' as const, label: '警报', icon: 'warning' },
  { type: 'error' as const, label: '错误', icon: 'error' },
].map((item) => {
  const count = activities.value.filter((activity) => activity.type === item.type).length
  return { ...item, count, percentage: activities.value.length ? count / activities.value.length * 100 : 0 }
}))

const cpuUsage = computed(() => usagePercent(statusSnapshot.value?.node?.system.cpuUsage))
const memoryUsage = computed(() => usagePercent(statusSnapshot.value?.node?.system.memUsage))
const availability = computed(() => {
  const history = statusSnapshot.value?.history || []
  return history.length ? history.filter((point) => point.status === 'online').length / history.length * 100 : null
})
const playerCapacity = computed(() => {
  const players = statusSnapshot.value?.minecraft?.players
  return players?.max ? Math.min(100, Math.max(0, players.online / players.max * 100)) : 0
})
const recentAvailability = computed(() => (statusSnapshot.value?.history || []).slice(-48))
const statusSourceErrors = computed(() => Object.values(statusSnapshot.value?.errors || {}).filter(Boolean) as string[])
const serverTone = computed<Tone>(() => {
  if (statusLoading.value && !statusSnapshot.value) return 'neutral'
  if (statusSnapshot.value?.minecraft?.online) return 'success'
  if (statusError.value || statusSnapshot.value?.minecraft?.online === false) return 'error'
  return 'neutral'
})
const serverLabel = computed(() => {
  if (statusLoading.value && !statusSnapshot.value) return '正在检查'
  if (statusSnapshot.value?.minecraft?.online) return '服务器在线'
  if (statusSnapshot.value?.minecraft?.online === false) return '服务器离线'
  if (statusError.value) return '状态不可用'
  return '等待状态数据'
})
const serverDetail = computed(() => {
  const minecraft = statusSnapshot.value?.minecraft
  if (minecraft?.online) return `${minecraft.version || 'Minecraft'} · ${statusSnapshot.value?.minecraftAddress || ''}`
  return minecraft?.error || statusError.value || statusSnapshot.value?.minecraftAddress || '尚未获取 Minecraft 服务状态'
})
const serverFacts = computed(() => {
  const minecraft = statusSnapshot.value?.minecraft
  return [
    { label: '在线玩家', value: minecraft?.players ? `${minecraft.players.online} / ${minecraft.players.max}` : '—', icon: 'groups' },
    { label: '网络延迟', value: Number.isFinite(minecraft?.delay) ? `${Math.round(Number(minecraft?.delay))} ms` : '—', icon: 'network_ping' },
    { label: '节点 CPU', value: statusSnapshot.value?.node ? `${cpuUsage.value.toFixed(0)}%` : '—', icon: 'memory' },
    { label: '节点内存', value: statusSnapshot.value?.node ? `${memoryUsage.value.toFixed(0)}%` : '—', icon: 'developer_board' },
    { label: '近期可用性', value: availability.value === null ? '—' : `${availability.value.toFixed(1)}%`, icon: 'monitor_heart' },
  ]
})

const dashboardMetrics = computed<Metric[]>(() => {
  const items: Metric[] = []
  if (canView('game-accounts')) items.push({ key: 'accounts', label: '游戏账户', value: String(gameAccounts.value.length), detail: `${accountsWithEmail.value} 个已绑定邮箱`, icon: 'manage_accounts', tone: 'info', to: '/game-accounts' })
  if (canView('bans')) items.push({ key: 'bans', label: '当前封禁', value: String(activeBans.value.length), detail: `${permanentBans.value} 个永久封禁`, icon: 'gavel', tone: activeBans.value.length ? 'warning' : 'success', to: '/bans' })
  if (canView('donors')) items.push({ key: 'donors', label: '累计捐赠', value: formatAmount(donationTotal.value), detail: `${donors.value.length} 位支持者`, icon: 'volunteer_activism', tone: 'success', to: '/donors' })
  if (canView('mail')) items.push({ key: 'mail', label: '未读投递', value: String(unreadMailDeliveries.value), detail: `${activeMails.value.length} 封有效邮件`, icon: 'mark_email_unread', tone: unreadMailDeliveries.value ? 'warning' : 'success', to: '/mail' })
  if (canView('audit-logs')) items.push({ key: 'audit', label: '今日操作', value: String(todayAuditCount.value), detail: `${auditLogs.value.length} 条近期记录`, icon: 'history', tone: 'neutral', to: '/audit-logs' })
  if (canView('updates') || canView('downloads')) {
    const count = (canView('updates') ? updates.value.length : 0) + (canView('downloads') ? downloads.value.length : 0)
    items.push({ key: 'releases', label: '发布资源', value: String(count), detail: `${forcedUpdates.value.length} 个强制更新`, icon: 'deployed_code', tone: forcedUpdates.value.length ? 'warning' : 'info', to: canView('updates') ? '/updates' : '/downloads' })
  }
  return items
})

const healthMeters = computed<HealthMeter[]>(() => {
  const meters: HealthMeter[] = []
  if (canView('status') && availability.value !== null) meters.push({ key: 'availability', label: '服务可用性', value: availability.value, display: `${availability.value.toFixed(1)}%`, tone: availability.value >= 95 ? 'success' : availability.value >= 80 ? 'warning' : 'error' })
  if (canView('status') && statusSnapshot.value?.node) {
    const resourceUsage = Math.max(cpuUsage.value, memoryUsage.value)
    meters.push({ key: 'node-resource', label: '节点资源占用', value: resourceUsage, display: `CPU ${cpuUsage.value.toFixed(0)}% · 内存 ${memoryUsage.value.toFixed(0)}%`, tone: resourceUsage >= 85 ? 'warning' : resourceUsage >= 70 ? 'info' : 'success' })
  }
  if (canView('mail')) meters.push({ key: 'mail-read', label: '邮件阅读率', value: mailReadRate.value, display: `${mailReadRate.value.toFixed(0)}%`, tone: mailReadRate.value >= 70 ? 'success' : mailReadRate.value >= 40 ? 'info' : 'warning' })
  if (canView('status') && statusSnapshot.value?.minecraft?.players?.max) meters.push({ key: 'capacity', label: '玩家容量占用', value: playerCapacity.value, display: `${playerCapacity.value.toFixed(0)}%`, tone: playerCapacity.value >= 90 ? 'warning' : 'info' })
  return meters
})

const attentionItems = computed<AttentionItem[]>(() => {
  const items: AttentionItem[] = []
  if (canView('status')) {
    if (statusError.value) items.push({ key: 'status-request', title: '状态接口不可用', detail: statusError.value, icon: 'cloud_off', tone: 'error', to: '/status' })
    else if (statusSnapshot.value?.minecraft?.online === false) items.push({ key: 'minecraft-offline', title: 'Minecraft 服务离线', detail: statusSnapshot.value.minecraft.error || '服务未响应', icon: 'dns', tone: 'error', to: '/status' })
    if (statusSourceErrors.value.length) items.push({ key: 'status-source', title: '部分监控源异常', detail: statusSourceErrors.value.join('；'), icon: 'warning', tone: 'warning', to: '/status' })
    if (cpuUsage.value >= 85 || memoryUsage.value >= 85) {
      const detail = [cpuUsage.value >= 85 ? `CPU ${cpuUsage.value.toFixed(0)}%` : '', memoryUsage.value >= 85 ? `内存 ${memoryUsage.value.toFixed(0)}%` : ''].filter(Boolean).join(' · ')
      items.push({ key: 'node-load', title: '节点资源占用偏高', detail, icon: 'memory', tone: 'warning', to: '/status' })
    }
  }
  if (canView('mail') && unreadMailDeliveries.value) items.push({ key: 'mail-unread', title: `${unreadMailDeliveries.value} 次投递尚未阅读`, detail: `${activeMails.value.length} 封有效邮件正在触达玩家`, icon: 'mark_email_unread', tone: 'info', to: '/mail' })
  if (canView('domain-mail') && domainMailUnread.count.value) items.push({ key: 'domain-mail-unread', title: `${domainMailUnread.count.value} 封域名邮件尚未阅读`, detail: '请前往域名邮件查看新邮件', icon: 'alternate_email', tone: 'warning', to: '/domain-mail' })
  return items.slice(0, 6)
})

const timelineEvents = computed<TimelineEvent[]>(() => {
  const events: TimelineEvent[] = []
  if (canView('audit-logs')) auditLogs.value.slice(0, 8).forEach((log) => events.push({ id: `audit-${log.id}`, title: log.action, detail: `${log.username} · ${log.method} ${log.path}`, time: log.time, icon: 'history', tone: 'neutral', to: '/audit-logs' }))
  if (canView('activity')) activities.value.slice(0, 8).forEach((activity) => events.push({ id: `activity-${activity.id}`, title: activity.content, detail: `服务器动态 · ${activityLabel(activity.type)}`, time: normalizeTimestamp(activity.date), icon: activity.type === 'success' ? 'check_circle' : activity.type === 'warning' ? 'warning' : activity.type === 'error' ? 'error' : 'info', tone: activity.type, to: '/activity' }))
  if (canView('chat')) chatMessages.value.slice(0, 6).forEach((message) => events.push({ id: `chat-${message.id}`, title: message.content, detail: `${message.name} · 聊天区`, time: message.time, icon: 'forum', tone: message.role === 'admin' ? 'success' : 'info', to: '/chat' }))
  if (canView('mail')) mails.value.slice(0, 6).forEach((mail) => events.push({ id: `mail-${mail.id}`, title: mail.title, detail: `${mail.sender} · ${mail.recipientCount} 位收件人`, time: mail.createdTime, icon: 'mail', tone: mail.expired ? 'neutral' : 'info', to: '/mail' }))
  logins.value.slice(0, 5).forEach((login, index) => events.push({ id: `login-${login.time}-${index}`, title: `${login.username || '后台账户'} 登录后台`, detail: `${login.ip} · ${formatClient(login)}`, time: login.time, icon: 'login', tone: 'success' }))
  return events.filter((event) => event.time > 0).sort((a, b) => b.time - a.time).slice(0, 10)
})

const releaseItems = computed<ReleaseItem[]>(() => {
  const items: ReleaseItem[] = []
  if (canView('updates')) updates.value.forEach((update) => items.push({ id: `update-${update.id}`, name: update.name, meta: `版本 ${update.latestVersion}`, time: normalizeTimestamp(`${update.release_date || ''} ${update.release_time || ''}`.trim()), icon: 'system_update', tone: update.forcedUpdate ? 'warning' : 'info', to: '/updates', tag: update.forcedUpdate ? '强制' : '更新' }))
  if (canView('downloads')) downloads.value.forEach((download) => items.push({ id: `download-${download.id}`, name: download.name, meta: `${download.type} · ${download.version}`, time: normalizeTimestamp(download.updatedAt), icon: download.type === '模组' ? 'extension' : 'inventory_2', tone: 'success', to: '/downloads', tag: download.type }))
  return items.sort((a, b) => b.time - a.time).slice(0, 6)
})

const quickLinks = computed(() => [
  { key: 'status', label: '服务器状态', icon: 'monitor_heart', to: '/status', badge: statusSnapshot.value?.minecraft?.online ? '在线' : '' },
  { key: 'server-manage', label: '服务器管理', icon: 'dns', to: '/server-manage', badge: '' },
  { key: 'game-accounts', label: '游戏账户', icon: 'manage_accounts', to: '/game-accounts', badge: gameAccounts.value.length ? String(gameAccounts.value.length) : '' },
  { key: 'mail', label: '服内邮件', icon: 'mail', to: '/mail', badge: unreadMailDeliveries.value ? String(unreadMailDeliveries.value) : '' },
  { key: 'activity', label: '服务器动态', icon: 'monitoring', to: '/activity', badge: activities.value.length ? String(activities.value.length) : '' },
  { key: 'audit-logs', label: '操作记录', icon: 'history', to: '/audit-logs', badge: todayAuditCount.value ? `今日 ${todayAuditCount.value}` : '' },
].filter((link) => canView(link.key)))

async function loadStatus() {
  if (!canView('status') || statusLoading.value) return
  statusLoading.value = true
  statusError.value = ''
  try { statusSnapshot.value = await $fetch<StatusSnapshot>('/api/admin/status') }
  catch (error: any) { statusError.value = error?.data?.statusMessage || error?.statusMessage || '服务器状态加载失败' }
  finally { statusLoading.value = false }
}

async function loadDashboard() {
  if (refreshing.value) return
  refreshing.value = true
  if (canView('status')) void loadStatus()
  const jobs: DashboardJob[] = [
    { label: '登录记录', run: () => $fetch<LoginRecord[]>('/api/auth/logins'), apply: (value) => { logins.value = value } },
    { label: '后台在线', run: () => $fetch<AdminPresence[]>('/api/auth/presence'), apply: (value) => { onlineAdmins.value = value } },
  ]
  if (canView('activity')) jobs.push({ label: '服务器动态', run: () => $fetch<ActivityRecord[]>('/api/activities'), apply: (value) => { activities.value = value } })
  if (canView('bans')) jobs.push({ label: '封禁列表', run: () => $fetch<BanRecord[]>('/api/bans'), apply: (value) => { bans.value = value } })
  if (canView('donors')) jobs.push({ label: '捐赠列表', run: () => $fetch<DonorRecord[]>('/api/donors'), apply: (value) => { donors.value = value } })
  if (canView('updates')) jobs.push({ label: '更新服务', run: () => $fetch<UpdateRecord[]>('/api/updates'), apply: (value) => { updates.value = value } })
  if (canView('downloads')) jobs.push({ label: '下载项目', run: () => $fetch<DownloadRecord[]>('/api/downloads'), apply: (value) => { downloads.value = value } })
  if (canView('game-accounts')) jobs.push({ label: '游戏账户', run: () => $fetch<GameAccountRecord[]>('/api/admin/game-accounts'), apply: (value) => { gameAccounts.value = value } })
  if (canView('audit-logs')) jobs.push({ label: '操作记录', run: () => $fetch<AuditLogRecord[]>('/api/admin/audit-logs'), apply: (value) => { auditLogs.value = value } })
  if (canView('mail')) jobs.push({ label: '服内邮件', run: () => $fetch<MailRecord[]>('/api/admin/mails'), apply: (value) => { mails.value = value } })
  if (canView('domain-mail')) jobs.push({ label: '域名邮件未读数', run: () => domainMailUnread.load(true), apply: (value) => { domainMailUnread.setCount(value) } })
  if (canView('chat')) jobs.push({ label: '聊天区', run: () => $fetch<ChatRecord[]>('/api/admin/chat'), apply: (value) => { chatMessages.value = value } })
  try {
    const results = await Promise.allSettled(jobs.map((job) => job.run()))
    const failed: string[] = []
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') jobs[index]?.apply(result.value)
      else if (jobs[index]) failed.push(jobs[index].label)
    })
    if (failed.length) showToast(`部分数据加载失败：${failed.join('、')}`, 'error')
    lastRefreshedAt.value = Date.now()
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function refreshOnlineAdmins() {
  if (document.hidden) return
  try {
    onlineAdmins.value = await $fetch<AdminPresence[]>('/api/auth/presence')
  } catch {
    // 仪表盘其他数据仍可正常使用，在线列表等待下一轮恢复。
  }
}

async function heartbeatDashboardPresence() {
  if (document.hidden) return
  try {
    onlineAdmins.value = await $fetch<AdminPresence[]>('/api/auth/presence', {
      method: 'POST',
      body: { path: '/' },
    })
  } catch {
    // 在线状态是辅助信息；短暂失败交给下一轮心跳恢复。
  }
}

function onDashboardVisibilityChange() {
  if (!document.hidden) heartbeatDashboardPresence()
}

onMounted(async () => {
  if (setupRequired.value) { loading.value = false; return }
  try { await access.load() }
  catch { showToast('后台权限信息加载失败', 'error') }
  await heartbeatDashboardPresence()
  await loadDashboard()
  presenceRefreshTimer = window.setInterval(refreshOnlineAdmins, 15_000)
  presenceHeartbeatTimer = window.setInterval(heartbeatDashboardPresence, 25_000)
  document.addEventListener('visibilitychange', onDashboardVisibilityChange)
})

onBeforeUnmount(() => {
  if (presenceRefreshTimer !== undefined) window.clearInterval(presenceRefreshTimer)
  if (presenceHeartbeatTimer !== undefined) window.clearInterval(presenceHeartbeatTimer)
  document.removeEventListener('visibilitychange', onDashboardVisibilityChange)
})
</script>

<template>
  <AdminSetup v-if="setupRequired" />
  <NuxtLayout v-else name="default">
    <div class="page dashboard-page">
      <header class="dashboard-header">
        <div class="dashboard-title-group">
          <div class="dashboard-kicker"><span>{{ currentUserRole }}</span><span>{{ todayLoginCount }} 次今日登录</span></div>
          <h1 class="page-title">控制台概览</h1>
        </div>
        <div class="dashboard-header-actions">
          <span class="dashboard-updated"><md-icon>schedule</md-icon>{{ lastRefreshedAt ? `更新于 ${formatRelativeTime(lastRefreshedAt)}` : '正在载入数据' }}</span>
          <md-icon-button aria-label="刷新仪表盘" title="刷新仪表盘" :disabled="refreshing || statusLoading" @click="loadDashboard">
            <md-icon :class="{ 'refresh-icon--loading': refreshing || statusLoading }">refresh</md-icon>
          </md-icon-button>
        </div>
      </header>

      <nav v-if="quickLinks.length" class="quick-nav" aria-label="常用管理入口">
        <NuxtLink v-for="link in quickLinks" :key="link.key" :to="link.to" class="quick-link">
          <md-icon>{{ link.icon }}</md-icon><span>{{ link.label }}</span><small v-if="link.badge">{{ link.badge }}</small>
        </NuxtLink>
      </nav>

      <section v-if="canView('status')" class="server-overview" :class="`server-overview--${serverTone}`">
        <div class="server-identity">
          <span class="server-state-icon" :class="`tone-icon--${serverTone}`"><md-icon>{{ serverTone === 'success' ? 'check_circle' : serverTone === 'error' ? 'cloud_off' : 'pending' }}</md-icon></span>
          <div>
            <div class="server-title-line"><h2>{{ serverLabel }}</h2><span v-if="statusSnapshot?.node" class="node-label">{{ statusSnapshot.nodeName }}</span></div>
            <p>{{ serverDetail }}</p>
          </div>
          <NuxtLink to="/status" class="server-detail-link" aria-label="查看完整服务器状态" title="查看完整服务器状态"><md-icon>arrow_forward</md-icon></NuxtLink>
        </div>
        <div class="server-facts">
          <div v-for="fact in serverFacts" :key="fact.label" class="server-fact"><md-icon>{{ fact.icon }}</md-icon><span><small>{{ fact.label }}</small><strong>{{ fact.value }}</strong></span></div>
        </div>
        <div v-if="recentAvailability.length" class="availability-strip" aria-label="近期节点可用性">
          <span v-for="point in recentAvailability" :key="point.time" :class="`availability-point availability-point--${point.status}`" :title="`${formatTime(point.time)} · ${point.status === 'online' ? '在线' : '离线'}`"></span>
        </div>
      </section>

      <section v-if="dashboardMetrics.length" class="metric-strip" aria-label="关键指标">
        <NuxtLink v-for="metric in dashboardMetrics" :key="metric.key" :to="metric.to" class="metric-item">
          <span class="metric-icon" :class="`tone-icon--${metric.tone}`"><md-icon>{{ metric.icon }}</md-icon></span>
          <span class="metric-copy"><small>{{ metric.label }}</small><strong>{{ loading ? '—' : metric.value }}</strong><span>{{ loading ? '正在加载' : metric.detail }}</span></span>
        </NuxtLink>
      </section>

      <section class="dashboard-panel online-panel" aria-labelledby="online-admins-title">
        <div class="section-heading">
          <div><h2 id="online-admins-title">后台在线</h2><p>{{ onlineAdmins.length }} 人正在操作后台</p></div>
          <span class="online-live"><i></i>实时</span>
        </div>
        <div v-if="loading" class="panel-empty">正在检查后台在线状态…</div>
        <div v-else-if="onlineAdmins.length" class="online-admin-list">
          <article v-for="admin in onlineAdmins" :key="admin.id" class="online-admin-item">
            <img v-if="admin.avatar" class="online-admin-avatar" :src="admin.avatar" alt="" />
            <span v-else class="online-admin-avatar online-admin-avatar--fallback">{{ (admin.fullName || admin.username || '?').slice(0, 1).toUpperCase() }}</span>
            <div class="online-admin-identity">
              <div><strong>{{ admin.fullName || admin.username }}</strong><span v-if="admin.isCurrent">当前账户</span></div>
              <small>@{{ admin.username }} · {{ admin.isOwner ? '所有者' : '管理员' }}</small>
            </div>
            <div class="online-admin-page"><md-icon>web</md-icon><span>{{ presencePageLabel(admin.path) }}</span></div>
            <time :title="formatTime(admin.lastSeenAt)">{{ formatRelativeTime(admin.lastSeenAt) }}</time>
          </article>
        </div>
        <p v-else class="panel-empty">当前没有用户正在操作后台</p>
      </section>

      <div class="dashboard-primary-grid">
        <section v-if="canView('activity') || healthMeters.length" class="dashboard-panel activity-panel">
          <div class="section-heading"><div><h2>运营脉搏</h2></div><NuxtLink v-if="canView('activity')" to="/activity" class="section-link">查看动态</NuxtLink></div>
          <div v-if="canView('activity')" class="activity-summary">
            <div class="activity-total"><strong>{{ loading ? '—' : activities.length }}</strong><span>条服务器动态</span></div>
            <div class="activity-segment-track" aria-label="服务器动态类型分布"><span v-for="item in activityOverviewItems" :key="item.type" :class="`activity-segment--${item.type}`" :style="{ width: `${item.percentage}%` }"></span></div>
            <div class="activity-legend"><div v-for="item in activityOverviewItems" :key="item.type"><span class="legend-marker" :class="`legend-marker--${item.type}`"></span><small>{{ item.label }}</small><strong>{{ item.count }}</strong></div></div>
          </div>
          <div v-if="healthMeters.length" class="health-meters">
            <div v-for="meter in healthMeters" :key="meter.key" class="health-meter"><div><span>{{ meter.label }}</span><strong>{{ loading ? '—' : meter.display }}</strong></div><div class="meter-track"><span :class="`meter-fill meter-fill--${meter.tone}`" :style="{ width: `${Math.min(100, Math.max(0, meter.value))}%` }"></span></div></div>
          </div>
        </section>

        <aside class="dashboard-panel attention-panel">
          <div class="section-heading"><div><h2>关注事项</h2><p>{{ attentionItems.length ? `${attentionItems.length} 项需要留意` : '当前没有明显异常' }}</p></div><md-icon :class="attentionItems.length ? 'attention-heading-icon--active' : 'attention-heading-icon--clear'">{{ attentionItems.length ? 'notifications_active' : 'verified' }}</md-icon></div>
          <div v-if="loading" class="panel-empty">正在汇总后台数据…</div>
          <div v-else-if="attentionItems.length" class="attention-list">
            <div v-for="item in attentionItems" :key="item.key" class="attention-item">
              <span class="attention-icon" :class="`tone-icon--${item.tone}`"><md-icon>{{ item.icon }}</md-icon></span>
              <div><NuxtLink v-if="item.to" :to="item.to">{{ item.title }}</NuxtLink><strong v-else>{{ item.title }}</strong><p>{{ item.detail }}</p></div>
              <md-icon v-if="item.to" class="row-arrow">chevron_right</md-icon>
            </div>
          </div>
          <div v-else class="all-clear"><md-icon>check_circle</md-icon><strong>运行状态平稳</strong></div>
        </aside>
      </div>

      <section class="dashboard-panel timeline-panel">
        <div class="section-heading"><div><h2>最近事件</h2></div><span class="section-count">{{ timelineEvents.length }} 条</span></div>
        <div v-if="loading" class="panel-empty">正在整理最近事件…</div>
        <div v-else-if="timelineEvents.length" class="timeline-list">
          <article v-for="event in timelineEvents" :key="event.id" class="timeline-item">
            <span class="timeline-icon" :class="`tone-icon--${event.tone}`"><md-icon>{{ event.icon }}</md-icon></span>
            <div class="timeline-copy"><NuxtLink v-if="event.to" :to="event.to">{{ event.title }}</NuxtLink><strong v-else>{{ event.title }}</strong><p>{{ event.detail }}</p></div>
            <time :datetime="new Date(event.time).toISOString()" :title="formatTime(event.time)">{{ formatRelativeTime(event.time) }}</time>
          </article>
        </div>
        <p v-else class="panel-empty">暂无最近事件</p>
      </section>

      <div class="dashboard-secondary-grid">
        <section class="dashboard-panel sessions-panel">
          <div class="section-heading"><div><h2>最近访问</h2><p>{{ uniqueLoginIps }} 个独立 IP · 今日 {{ todayLoginCount }} 次</p></div><md-icon>devices</md-icon></div>
          <div v-if="loading" class="panel-empty">正在加载访问记录…</div>
          <div v-else-if="logins.length" class="session-list">
            <div v-for="(login, index) in logins.slice(0, 5)" :key="`${login.time}-${index}`" class="session-item">
              <span class="session-avatar">{{ (login.username || '?').slice(0, 1).toUpperCase() }}</span>
              <div><strong>{{ login.username || '未知账户' }}</strong><span>{{ formatClient(login) }}</span></div>
              <div class="session-meta"><code>{{ login.ip }}</code><small v-if="login.location"><md-icon>location_on</md-icon>{{ login.location }}</small><time :title="formatTime(login.time)">{{ formatRelativeTime(login.time) }}</time></div>
            </div>
          </div>
          <p v-else class="panel-empty">暂无登录记录</p>
        </section>

        <section v-if="canView('updates') || canView('downloads')" class="dashboard-panel releases-panel">
          <div class="section-heading"><div><h2>发布目录</h2><p>{{ updates.length }} 个更新 · {{ downloads.length }} 个下载项目</p></div><NuxtLink :to="canView('updates') ? '/updates' : '/downloads'" class="section-link">管理</NuxtLink></div>
          <div v-if="loading" class="panel-empty">正在加载发布资源…</div>
          <div v-else-if="releaseItems.length" class="release-list">
            <NuxtLink v-for="item in releaseItems" :key="item.id" :to="item.to" class="release-item">
              <span class="release-icon" :class="`tone-icon--${item.tone}`"><md-icon>{{ item.icon }}</md-icon></span>
              <div><strong>{{ item.name }}</strong><span>{{ item.meta }}</span></div>
              <div class="release-meta"><small>{{ item.tag }}</small><time v-if="item.time" :title="formatTime(item.time)">{{ formatRelativeTime(item.time) }}</time></div>
            </NuxtLink>
          </div>
          <p v-else class="panel-empty">暂无发布资源</p>
        </section>
      </div>
    </div>
  </NuxtLayout>
</template>

<style scoped>
.dashboard-page { width: min(100%, 1280px); }
.dashboard-header, .section-heading, .server-title-line, .dashboard-header-actions, .dashboard-kicker { display: flex; align-items: center; }
.dashboard-header { justify-content: space-between; gap: 24px; margin-bottom: 18px; }
.dashboard-title-group { min-width: 0; }
.dashboard-title-group .page-title { margin: 5px 0 4px; font-size: 26px; font-weight: 600; letter-spacing: 0; }
.dashboard-title-group > p { margin: 0; color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.dashboard-kicker { flex-wrap: wrap; gap: 7px; color: var(--md-sys-color-on-surface-variant); font-size: 11px; font-weight: 600; }
.dashboard-kicker span { padding: 3px 7px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 4px; background: var(--md-sys-color-surface-container); }
.dashboard-header-actions { flex: 0 0 auto; gap: 8px; }
.dashboard-updated { display: inline-flex; align-items: center; gap: 6px; color: var(--md-sys-color-on-surface-variant); font-size: 12px; white-space: nowrap; }
.dashboard-updated md-icon { --md-icon-size: 17px; }
.refresh-icon--loading { animation: dashboard-spin 850ms linear infinite; }

.quick-nav, .metric-strip { display: grid; margin-bottom: 16px; overflow: hidden; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface-container); }
.quick-nav { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.quick-link { min-width: 0; min-height: 52px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 12px; border-right: 1px solid var(--md-sys-color-outline-variant); color: var(--md-sys-color-on-surface); text-decoration: none; font-size: 12px; font-weight: 600; transition: background-color 160ms ease, color 160ms ease; }
.quick-link:last-child { border-right: 0; }
.quick-link:hover, .metric-item:hover { background: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent); color: var(--md-sys-color-primary); }
.quick-link md-icon { flex: 0 0 auto; --md-icon-size: 20px; }
.quick-link span, .quick-link small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quick-link small { flex: 0 0 auto; padding: 2px 5px; border-radius: 4px; background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); font-size: 10px; }

.online-panel { margin-bottom: 16px; }
.online-live { display: inline-flex; align-items: center; gap: 6px; color: var(--act-success); font-size: 11px; font-weight: 700; }
.online-live i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 14%, transparent); }
.online-admin-list { margin-top: 14px; display: grid; gap: 2px; }
.online-admin-item { min-width: 0; min-height: 54px; display: grid; grid-template-columns: 36px minmax(0, 1fr) minmax(120px, .55fr) auto; align-items: center; gap: 11px; padding: 8px 10px; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.online-admin-item:last-child { border-bottom: 0; }
.online-admin-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; }
.online-admin-avatar--fallback { display: grid; place-items: center; color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); font-size: 12px; font-weight: 700; }
.online-admin-identity { min-width: 0; display: grid; gap: 2px; }
.online-admin-identity > div { min-width: 0; display: flex; align-items: center; gap: 7px; }
.online-admin-identity strong, .online-admin-identity small, .online-admin-page span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.online-admin-identity strong { font-size: 12px; }
.online-admin-identity > div span { flex: 0 0 auto; padding: 2px 5px; border-radius: 4px; color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); font-size: 8px; font-weight: 700; }
.online-admin-identity small, .online-admin-item time { color: var(--md-sys-color-on-surface-variant); font-size: 9px; }
.online-admin-page { min-width: 0; display: flex; align-items: center; gap: 6px; color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.online-admin-page md-icon { flex: 0 0 auto; --md-icon-size: 16px; }
.online-admin-item time { white-space: nowrap; }

.server-overview { position: relative; margin-bottom: 16px; overflow: hidden; border: 1px solid var(--md-sys-color-outline-variant); border-left-width: 4px; border-radius: 8px; background: var(--md-sys-color-surface-container); }
.server-overview--success { border-left-color: var(--act-success); } .server-overview--error { border-left-color: var(--act-error); } .server-overview--neutral { border-left-color: var(--md-sys-color-outline); }
.server-identity { min-width: 0; display: grid; grid-template-columns: 44px minmax(0, 1fr) 40px; align-items: center; gap: 12px; padding: 18px 20px 14px; }
.server-state-icon, .metric-icon, .attention-icon, .timeline-icon, .release-icon { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.server-state-icon { width: 44px; height: 44px; border-radius: 50%; } .server-state-icon md-icon { --md-icon-size: 24px; }
.server-title-line { flex-wrap: wrap; gap: 8px; } .server-title-line h2 { margin: 0; font-size: 17px; font-weight: 600; }
.node-label { padding: 2px 6px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 4px; color: var(--md-sys-color-on-surface-variant); font: 600 10px/1.4 'Roboto Mono', ui-monospace, monospace; }
.server-identity p { margin: 4px 0 0; overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.server-detail-link { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--md-sys-color-on-surface-variant); transition: background-color 160ms ease, color 160ms ease, transform 160ms ease; }
.server-detail-link:hover { background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-primary); transform: translateX(2px); }
.server-facts { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-top: 1px solid var(--md-sys-color-outline-variant); }
.server-fact { min-width: 0; min-height: 68px; display: flex; align-items: center; gap: 9px; padding: 12px 16px; border-right: 1px solid var(--md-sys-color-outline-variant); }
.server-fact:last-child { border-right: 0; } .server-fact > md-icon { flex: 0 0 auto; color: var(--md-sys-color-on-surface-variant); --md-icon-size: 20px; }
.server-fact span { min-width: 0; display: grid; gap: 2px; } .server-fact small { color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.server-fact strong { overflow: hidden; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.availability-strip { height: 7px; display: flex; gap: 2px; padding: 0 16px 3px; }
.availability-point { min-width: 2px; flex: 1; border-radius: 1px; } .availability-point--online { background: var(--act-success); } .availability-point--offline { background: var(--act-error); }

.metric-strip { grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); }
.metric-item { min-width: 0; min-height: 108px; display: flex; align-items: center; gap: 12px; padding: 16px; border-right: 1px solid var(--md-sys-color-outline-variant); color: inherit; text-decoration: none; transition: background-color 160ms ease; }
.metric-item:last-child { border-right: 0; } .metric-icon, .attention-icon, .timeline-icon, .release-icon { width: 36px; height: 36px; border-radius: 8px; }
.metric-icon md-icon, .attention-icon md-icon, .timeline-icon md-icon, .release-icon md-icon { --md-icon-size: 19px; }
.metric-copy { min-width: 0; display: grid; gap: 2px; }
.metric-copy small, .metric-copy span { overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.metric-copy strong { overflow: hidden; font-size: 22px; line-height: 1.2; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }

.dashboard-primary-grid, .dashboard-secondary-grid { display: grid; gap: 16px; margin-bottom: 16px; }
.dashboard-primary-grid { grid-template-columns: minmax(0, 1.55fr) minmax(300px, .85fr); }
.dashboard-secondary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 16px; margin-bottom: 0; }
.dashboard-panel { min-width: 0; padding: 20px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface-container); }
.section-heading { min-width: 0; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.section-heading > div { min-width: 0; } .section-heading h2 { margin: 0; font-size: 16px; font-weight: 600; }
.section-heading p { margin: 4px 0 0; overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.section-heading > md-icon { flex: 0 0 auto; color: var(--md-sys-color-on-surface-variant); }
.section-link { flex: 0 0 auto; color: var(--md-sys-color-primary); font-size: 12px; font-weight: 600; text-decoration: none; } .section-link:hover { text-decoration: underline; }
.section-count { flex: 0 0 auto; color: var(--md-sys-color-on-surface-variant); font-size: 11px; }

.activity-summary { padding-bottom: 18px; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.activity-total { display: flex; align-items: baseline; gap: 8px; } .activity-total strong { font-size: 32px; line-height: 1; font-weight: 650; } .activity-total span { color: var(--md-sys-color-on-surface-variant); font-size: 12px; }
.activity-segment-track { height: 9px; display: flex; margin: 16px 0; overflow: hidden; border-radius: 3px; background: var(--md-sys-color-surface-container-high); }
.activity-segment-track span { height: 100%; transition: width 260ms cubic-bezier(.2, 0, 0, 1); }
.activity-segment--info { background: var(--act-info); } .activity-segment--success { background: var(--act-success); } .activity-segment--warning { background: var(--act-warning); } .activity-segment--error { background: var(--act-error); }
.activity-legend { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.activity-legend > div { min-width: 0; display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 6px; }
.activity-legend small { overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; } .activity-legend strong { font-size: 12px; }
.legend-marker { width: 7px; height: 7px; border-radius: 50%; } .legend-marker--info { background: var(--act-info); } .legend-marker--success { background: var(--act-success); } .legend-marker--warning { background: var(--act-warning); } .legend-marker--error { background: var(--act-error); }
.health-meters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px 24px; padding-top: 18px; }
.health-meter > div:first-child { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; font-size: 11px; }
.health-meter span { color: var(--md-sys-color-on-surface-variant); } .health-meter strong { font-size: 11px; }
.meter-track { height: 6px; overflow: hidden; border-radius: 2px; background: var(--md-sys-color-surface-container-high); }
.meter-fill { display: block; height: 100%; border-radius: inherit; transition: width 260ms cubic-bezier(.2, 0, 0, 1); }
.meter-fill--info { background: var(--act-info); } .meter-fill--success { background: var(--act-success); } .meter-fill--warning { background: var(--act-warning); } .meter-fill--error { background: var(--act-error); } .meter-fill--neutral { background: var(--md-sys-color-outline); }

.attention-heading-icon--active { color: var(--act-warning) !important; } .attention-heading-icon--clear { color: var(--act-success) !important; }
.attention-list, .timeline-list, .session-list, .release-list { display: grid; }
.attention-item { min-width: 0; display: grid; grid-template-columns: 36px minmax(0, 1fr) 18px; align-items: center; gap: 10px; padding: 12px 0; border-top: 1px solid var(--md-sys-color-outline-variant); }
.attention-item:first-child, .timeline-item:first-child, .session-item:first-child, .release-item:first-child { padding-top: 0; border-top: 0; }
.attention-item:last-child, .timeline-item:last-child, .session-item:last-child, .release-item:last-child { padding-bottom: 0; }
.attention-item > div, .timeline-copy, .session-item > div, .release-item > div { min-width: 0; }
.attention-item a, .attention-item strong, .timeline-copy a, .timeline-copy strong { display: block; overflow: hidden; color: var(--md-sys-color-on-surface); font-size: 12px; font-weight: 600; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.attention-item a:hover, .timeline-copy a:hover, .release-item:hover strong { color: var(--md-sys-color-primary); }
.attention-item p { display: -webkit-box; margin: 3px 0 0; overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-size: 10px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.row-arrow { color: var(--md-sys-color-outline); --md-icon-size: 18px; }
.all-clear { min-height: 190px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; text-align: center; }
.all-clear md-icon { margin-bottom: 10px; color: var(--act-success); --md-icon-size: 38px; } .all-clear strong { font-size: 14px; }

.timeline-item { min-width: 0; display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 58px; padding: 9px 0; border-top: 1px solid var(--md-sys-color-outline-variant); }
.timeline-copy p { margin: 3px 0 0; overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.timeline-item > time, .session-meta time, .release-meta time { color: var(--md-sys-color-on-surface-variant); font-size: 10px; white-space: nowrap; }
.session-item, .release-item { min-width: 0; min-height: 56px; display: grid; align-items: center; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; padding: 9px 0; border-top: 1px solid var(--md-sys-color-outline-variant); }
.release-item { color: inherit; text-decoration: none; }
.session-avatar { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); font-size: 12px; font-weight: 700; }
.session-item strong, .release-item strong { display: block; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.session-item > div > span, .release-item > div > span { display: block; margin-top: 3px; overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.session-meta, .release-meta { display: grid; justify-items: end; gap: 3px; }
.session-meta code { color: var(--md-sys-color-on-surface-variant); font: 10px 'Roboto Mono', ui-monospace, monospace; }
.session-meta small { display: inline-flex; align-items: center; gap: 2px; color: var(--md-sys-color-on-surface-variant); font-size: 9px; }
.session-meta small md-icon { --md-icon-size: 11px; }
.release-meta small { padding: 2px 5px; border-radius: 4px; background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface-variant); font-size: 9px; }
.panel-empty { margin: 0; padding: 28px 8px; color: var(--md-sys-color-on-surface-variant); font-size: 12px; text-align: center; }

.tone-icon--info { background: color-mix(in srgb, var(--act-info) 13%, var(--md-sys-color-surface-container)); color: var(--act-info); }
.tone-icon--success { background: color-mix(in srgb, var(--act-success) 13%, var(--md-sys-color-surface-container)); color: var(--act-success); }
.tone-icon--warning { background: color-mix(in srgb, var(--act-warning) 14%, var(--md-sys-color-surface-container)); color: var(--act-warning); }
.tone-icon--error { background: color-mix(in srgb, var(--act-error) 13%, var(--md-sys-color-surface-container)); color: var(--act-error); }
.tone-icon--neutral { background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface-variant); }
@keyframes dashboard-spin { to { transform: rotate(360deg); } }

@media (max-width: 1050px) {
  .quick-nav { grid-template-columns: repeat(3, minmax(0, 1fr)); } .quick-link:nth-child(3n) { border-right: 0; } .quick-link:nth-child(n + 4) { border-top: 1px solid var(--md-sys-color-outline-variant); }
  .server-facts { grid-template-columns: repeat(3, minmax(0, 1fr)); } .server-fact:nth-child(3) { border-right: 0; } .server-fact:nth-child(n + 4) { border-top: 1px solid var(--md-sys-color-outline-variant); }
  .dashboard-primary-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 760px) {
  .dashboard-header { align-items: flex-start; } .dashboard-header-actions { align-items: flex-end; flex-direction: column-reverse; } .dashboard-updated { white-space: normal; text-align: right; }
  .metric-strip, .dashboard-secondary-grid { grid-template-columns: minmax(0, 1fr); }
  .metric-item { min-height: 90px; border-right: 0; border-top: 1px solid var(--md-sys-color-outline-variant); } .metric-item:first-child { border-top: 0; }
  .health-meters { grid-template-columns: minmax(0, 1fr); }
  .online-admin-item { grid-template-columns: 36px minmax(0, 1fr) auto; }
  .online-admin-page { grid-column: 2 / -1; }
}
@media (max-width: 560px) {
  .dashboard-title-group .page-title { font-size: 22px; } .dashboard-title-group > p { max-width: 280px; line-height: 1.5; } .dashboard-updated { display: none; }
  .quick-nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } .quick-link:nth-child(3n) { border-right: 1px solid var(--md-sys-color-outline-variant); } .quick-link:nth-child(2n) { border-right: 0; } .quick-link:nth-child(n + 3) { border-top: 1px solid var(--md-sys-color-outline-variant); }
  .server-identity { grid-template-columns: 40px minmax(0, 1fr) 34px; gap: 9px; padding: 15px 13px 12px; } .server-state-icon { width: 40px; height: 40px; } .server-identity p { white-space: normal; }
  .server-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } .server-fact, .server-fact:nth-child(3) { border-right: 1px solid var(--md-sys-color-outline-variant); } .server-fact:nth-child(2n) { border-right: 0; } .server-fact:nth-child(n + 3) { border-top: 1px solid var(--md-sys-color-outline-variant); }
  .dashboard-panel { padding: 16px; } .activity-legend { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .online-admin-item { grid-template-columns: 32px minmax(0, 1fr); padding-inline: 0; }
  .online-admin-avatar { width: 32px; height: 32px; }
  .online-admin-item > time, .online-admin-page { grid-column: 2; }
  .timeline-item { grid-template-columns: 34px minmax(0, 1fr); } .timeline-item > time { grid-column: 2; margin-top: -7px; }
  .session-item, .release-item { grid-template-columns: 34px minmax(0, 1fr); } .session-meta, .release-meta { grid-column: 2; justify-items: start; }
}
</style>
