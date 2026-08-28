<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { clientDeviceTypeLabel } from '#shared/client-device'

useHead({ title: '操作记录' })

type RecordKind = 'action' | 'login' | 'logout'
type RecordMode = 'all' | 'actions' | 'connections'

interface SessionInfo {
  createdAt: number
  lastSeenAt: number
  ip: string
  browser: string
  os: string
  device: string
  location: string
  isCurrent: boolean
}

interface MemberStatus {
  id: number
  username: string
  avatar: string
  fullName: string
  isOwner: boolean
  isActive: boolean
  createdAt: number
  isCurrent: boolean
  loggedIn: boolean
  online: boolean
  sessionCount: number
  lastSeenAt: number | null
  lastConnection: SessionInfo | null
}

interface CurrentAccount extends MemberStatus {
  currentSession: SessionInfo | null
}

interface OperationRecord {
  id: string
  kind: RecordKind
  userId: number | null
  username: string
  action: string
  method: string
  path: string
  ip: string
  time: number
  browser: string
  os: string
  device: string
  location: string
}

interface AuditOverview {
  generatedAt: number
  onlineWindowMs: number
  currentAccount: CurrentAccount | null
  members: MemberStatus[]
  records: OperationRecord[]
}

const overview = ref<AuditOverview | null>(null)
const loading = ref(false)
const refreshing = ref(false)
const selectedMemberId = ref<number | null>(null)
const mode = ref<RecordMode>('all')
const search = ref('')
const now = ref(Date.now())
const { showToast } = useToast()
let refreshTimer: ReturnType<typeof setInterval> | undefined
let clockTimer: ReturnType<typeof setInterval> | undefined

const members = computed(() => [...(overview.value?.members || [])].sort((left, right) =>
  Number(right.isCurrent) - Number(left.isCurrent)
  || Number(right.online) - Number(left.online)
  || Number(right.loggedIn) - Number(left.loggedIn)
  || Number(right.isActive) - Number(left.isActive)
  || left.username.localeCompare(right.username, 'zh-CN'),
))
const currentAccount = computed(() => overview.value?.currentAccount || null)
const currentDevice = computed(() => currentAccount.value?.currentSession || currentAccount.value?.lastConnection || null)
const onlineCount = computed(() => members.value.filter((member) => member.online).length)
const loggedInCount = computed(() => members.value.filter((member) => member.loggedIn).length)
const todayCount = computed(() => (overview.value?.records || []).filter((record) => sameLocalDay(record.time, now.value)).length)
const connectionCount = computed(() => (overview.value?.records || []).filter((record) => record.kind === 'login').length)
const memberMap = computed(() => new Map(members.value.map((member) => [member.id, member])))

const filteredRecords = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase('zh-CN')
  return (overview.value?.records || []).filter((record) => {
    if (selectedMemberId.value !== null && record.userId !== selectedMemberId.value) return false
    if (mode.value === 'actions' && record.kind !== 'action') return false
    if (mode.value === 'connections' && record.kind === 'action') return false
    if (!needle) return true
    return [record.username, record.action, record.method, record.path, record.ip, record.location, record.browser, record.os, record.device]
      .some((value) => value.toLocaleLowerCase('zh-CN').includes(needle))
  })
})

const groupedRecords = computed(() => {
  const groups: Array<{ key: string; label: string; records: OperationRecord[] }> = []
  for (const record of filteredRecords.value) {
    const key = localDayKey(record.time)
    let group = groups.at(-1)
    if (!group || group.key !== key) {
      group = { key, label: formatDayLabel(record.time), records: [] }
      groups.push(group)
    }
    group.records.push(record)
  }
  return groups
})

async function loadRecords(silent = false) {
  if (refreshing.value) return
  refreshing.value = true
  if (!overview.value) loading.value = true
  try {
    overview.value = await $fetch<AuditOverview>('/api/admin/audit-logs', {
      query: { view: 'overview', limit: 800 },
    })
    now.value = Date.now()
  } catch (error: any) {
    if (!silent) showToast(error?.data?.statusMessage || '操作记录加载失败', 'error')
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

function sameLocalDay(left: number, right: number) {
  return localDayKey(left) === localDayKey(right)
}

function localDayKey(value: number) {
  const date = new Date(value)
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

function formatDayLabel(value: number) {
  const date = new Date(value)
  const today = new Date(now.value)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (localDayKey(value) === localDayKey(today.getTime())) return '今天'
  if (localDayKey(value) === localDayKey(yesterday.getTime())) return '昨天'
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatFullTime(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString('zh-CN') : '暂无记录'
}

function formatRelativeTime(value: number | null | undefined) {
  if (!value) return '暂无活动'
  const seconds = Math.max(0, Math.floor((now.value - value) / 1000))
  if (seconds < 45) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`
  return `${Math.floor(seconds / 86_400)} 天前`
}

function formatClient(client: Pick<SessionInfo, 'browser' | 'os' | 'device'> | OperationRecord | null) {
  if (!client) return '未知设备'
  return [client.device, client.browser, client.os].filter(Boolean).join(' · ') || '未知设备'
}

function memberInitial(member: Pick<MemberStatus, 'username' | 'fullName'> | null | undefined) {
  return (member?.fullName || member?.username || '?').trim().slice(0, 1).toLocaleUpperCase('zh-CN')
}

function recordMember(record: OperationRecord) {
  return record.userId === null ? undefined : memberMap.value.get(record.userId)
}

function memberRecordCount(memberId: number) {
  return (overview.value?.records || []).filter((record) => record.userId === memberId).length
}

function memberStatusLabel(member: MemberStatus) {
  if (!member.isActive) return '已停用'
  if (member.online) return '在线'
  if (member.loggedIn) return '已登录'
  return '离线'
}

function recordIcon(record: OperationRecord) {
  if (record.kind === 'logout') return 'logout'
  return 'edit_note'
}

function recordKindLabel(kind: RecordKind) {
  if (kind === 'login') return '设备连接'
  if (kind === 'logout') return '退出登录'
  return '管理操作'
}

function clearFilters() {
  selectedMemberId.value = null
  mode.value = 'all'
  search.value = ''
}

onMounted(() => {
  loadRecords()
  refreshTimer = setInterval(() => loadRecords(true), 60_000)
  clockTimer = setInterval(() => { now.value = Date.now() }, 30_000)
})

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  if (clockTimer) clearInterval(clockTimer)
})
</script>

<template>
  <div class="page audit-page">
    <header class="page-heading">
      <div>
        <h1 class="page-title">操作记录</h1>
        <p v-if="overview" class="sync-time">最后同步 {{ formatRelativeTime(overview.generatedAt) }}</p>
      </div>
      <md-icon-button aria-label="刷新操作记录" title="刷新" :disabled="refreshing" @click="loadRecords()">
        <md-icon :class="{ 'refresh-icon--active': refreshing }">refresh</md-icon>
      </md-icon-button>
    </header>

    <section v-if="currentAccount" class="account-status" aria-label="当前账户状态">
      <div class="account-identity">
        <img v-if="currentAccount.avatar" class="account-avatar" :src="currentAccount.avatar" :alt="`${currentAccount.username} 的头像`" />
        <span v-else class="account-avatar account-avatar--fallback">{{ memberInitial(currentAccount) }}</span>
        <div class="account-copy">
          <span class="eyebrow">当前账户</span>
          <strong>{{ currentAccount.fullName || currentAccount.username }}</strong>
          <span v-if="currentAccount.fullName" class="account-username">@{{ currentAccount.username }}</span>
        </div>
      </div>
      <div class="account-states">
        <span class="state-badge state-badge--success"><i></i>已登录</span>
        <span class="state-badge" :class="currentAccount.online ? 'state-badge--online' : 'state-badge--idle'"><i></i>{{ currentAccount.online ? '在线' : '暂离' }}</span>
      </div>
      <div class="account-session">
        <div><span><DeviceClientIcon :client="currentDevice" size="small" />当前设备</span><strong>{{ formatClient(currentDevice) }}</strong></div>
        <div><span>连接地址</span><strong class="connection-address"><code>{{ currentDevice?.ip || '未知' }}</code><small v-if="currentDevice?.location">{{ currentDevice.location }}</small></strong></div>
        <div><span>最近活动</span><strong :title="formatFullTime(currentAccount.lastSeenAt)">{{ formatRelativeTime(currentAccount.lastSeenAt) }}</strong></div>
      </div>
    </section>

    <section class="summary-grid" aria-label="记录概览">
      <article class="summary-item"><span class="summary-icon summary-icon--online"><md-icon>radio_button_checked</md-icon></span><div><strong>{{ onlineCount }}</strong><span>在线成员</span></div></article>
      <article class="summary-item"><span class="summary-icon summary-icon--login"><md-icon>verified_user</md-icon></span><div><strong>{{ loggedInCount }}</strong><span>已登录成员</span></div></article>
      <article class="summary-item"><span class="summary-icon summary-icon--today"><md-icon>today</md-icon></span><div><strong>{{ todayCount }}</strong><span>今日记录</span></div></article>
      <article class="summary-item"><span class="summary-icon summary-icon--device"><md-icon>devices</md-icon></span><div><strong>{{ connectionCount }}</strong><span>设备连接</span></div></article>
    </section>

    <div class="activity-workspace">
      <aside class="member-panel">
        <div class="panel-heading"><div><h2>成员状态</h2><span>{{ onlineCount }} / {{ members.length }} 在线</span></div><md-icon>group</md-icon></div>
        <div class="member-list">
          <button type="button" class="member-item member-item--all" :class="{ 'member-item--selected': selectedMemberId === null }" @click="selectedMemberId = null">
            <span class="member-avatar member-avatar--all"><md-icon>groups</md-icon></span>
            <span class="member-copy"><strong>全部成员</strong><small>{{ overview?.records.length || 0 }} 条记录</small></span>
          </button>
          <button v-for="member in members" :key="member.id" type="button" class="member-item" :class="{ 'member-item--selected': selectedMemberId === member.id }" @click="selectedMemberId = member.id">
            <span class="member-avatar-wrap">
              <img v-if="member.avatar" class="member-avatar" :src="member.avatar" alt="" />
              <span v-else class="member-avatar member-avatar--fallback">{{ memberInitial(member) }}</span>
              <i class="presence-dot" :class="member.online ? 'presence-dot--online' : member.loggedIn ? 'presence-dot--idle' : 'presence-dot--offline'"></i>
            </span>
            <span class="member-copy">
              <strong>{{ member.fullName || member.username }}<em v-if="member.isCurrent">当前</em></strong>
              <small>{{ memberStatusLabel(member) }} · {{ formatRelativeTime(member.lastSeenAt) }}</small>
            </span>
            <span class="member-count">{{ memberRecordCount(member.id) }}</span>
          </button>
        </div>
      </aside>

      <section class="records-panel">
        <div class="panel-heading records-heading"><div><h2>记录时间线</h2><span>{{ filteredRecords.length }} 条</span></div><md-icon>history</md-icon></div>
        <div class="record-controls">
          <md-outlined-text-field class="record-search" label="搜索记录" :value="search" @input="search = ($event.target as HTMLInputElement).value"><md-icon slot="leading-icon">search</md-icon></md-outlined-text-field>
          <div class="mode-control" aria-label="记录类型">
            <button type="button" :class="{ 'mode-button--active': mode === 'all' }" @click="mode = 'all'">全部</button>
            <button type="button" :class="{ 'mode-button--active': mode === 'actions' }" @click="mode = 'actions'">管理操作</button>
            <button type="button" :class="{ 'mode-button--active': mode === 'connections' }" @click="mode = 'connections'">登录活动</button>
          </div>
        </div>

        <div v-if="loading" class="loading-state"><md-circular-progress indeterminate></md-circular-progress></div>
        <div v-else-if="groupedRecords.length" class="record-groups">
          <section v-for="group in groupedRecords" :key="group.key" class="record-group">
            <div class="day-heading"><span>{{ group.label }}</span><i></i></div>
            <article v-for="record in group.records" :key="record.id" class="record-item">
              <span class="record-marker" :class="`record-marker--${record.kind}`" :title="record.kind === 'login' ? clientDeviceTypeLabel(record) : recordKindLabel(record.kind)">
                <DeviceClientIcon v-if="record.kind === 'login'" :client="record" />
                <md-icon v-else>{{ recordIcon(record) }}</md-icon>
              </span>
              <div class="record-body">
                <div class="record-title-row"><strong>{{ record.action }}</strong><span class="record-kind" :class="`record-kind--${record.kind}`">{{ recordKindLabel(record.kind) }}</span></div>
                <div class="record-actor">
                  <span class="mini-avatar">{{ memberInitial(recordMember(record) || { username: record.username, fullName: '' }) }}</span>
                  <span>{{ recordMember(record)?.fullName || record.username || '未知成员' }}</span>
                  <small v-if="recordMember(record)?.fullName">@{{ record.username }}</small>
                </div>
                <div v-if="record.kind === 'login'" class="record-detail"><DeviceClientIcon :client="record" size="small" /><span>{{ formatClient(record) }}</span></div>
                <div class="record-meta">
                  <code v-if="record.kind !== 'login'" class="method-code">{{ record.method }}</code>
                  <code v-if="record.kind !== 'login'" class="path-code">{{ record.path }}</code>
                  <span v-if="record.ip"><md-icon>location_on</md-icon><code>{{ record.ip }}</code><small v-if="record.location">{{ record.location }}</small></span>
                </div>
              </div>
              <time :datetime="new Date(record.time).toISOString()" :title="formatFullTime(record.time)"><strong>{{ formatTime(record.time) }}</strong><span>{{ formatRelativeTime(record.time) }}</span></time>
            </article>
          </section>
        </div>
        <div v-else class="empty-state">
          <md-icon>manage_search</md-icon><strong>没有匹配的记录</strong>
          <md-text-button v-if="search || mode !== 'all' || selectedMemberId !== null" @click="clearFilters">清除筛选</md-text-button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.audit-page { width: min(100%, 1320px); }
.page-heading { display: flex; min-height: 52px; align-items: flex-start; justify-content: space-between; gap: 16px; }
.page-title { margin-bottom: 3px; }
.sync-time { margin: 0; color: var(--md-sys-color-on-surface-variant); font-size: 12px; }
.refresh-icon--active { animation: refresh-spin 900ms linear infinite; }
.account-status { min-width: 0; display: grid; grid-template-columns: minmax(220px, 1fr) auto minmax(360px, 1.5fr); align-items: center; gap: 22px; padding: 18px 20px; border: 1px solid color-mix(in srgb, var(--act-success) 34%, var(--md-sys-color-outline-variant)); border-radius: 8px; background: color-mix(in srgb, var(--act-success) 5%, var(--md-sys-color-surface-container)); }
.account-identity { min-width: 0; display: flex; align-items: center; gap: 12px; }
.account-avatar { width: 48px; height: 48px; flex: 0 0 48px; border-radius: 50%; object-fit: cover; }
.account-avatar--fallback { display: grid; place-items: center; background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); font-size: 18px; font-weight: 700; }
.account-copy { min-width: 0; display: grid; gap: 2px; }
.eyebrow { color: var(--md-sys-color-on-surface-variant); font-size: 10px; font-weight: 700; letter-spacing: 0; text-transform: uppercase; }
.account-copy strong { overflow: hidden; font-size: 16px; text-overflow: ellipsis; white-space: nowrap; }
.account-username { overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.account-states { display: flex; flex-wrap: wrap; gap: 7px; }
.state-badge { min-height: 28px; display: inline-flex; align-items: center; gap: 7px; padding: 0 10px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.state-badge i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.state-badge--success, .state-badge--online { border-color: color-mix(in srgb, var(--act-success) 45%, transparent); color: var(--act-success); background: color-mix(in srgb, var(--act-success) 8%, transparent); }
.state-badge--idle { color: var(--act-warning); background: color-mix(in srgb, var(--act-warning) 8%, transparent); }
.account-session { min-width: 0; display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(110px, 0.8fr) minmax(90px, 0.7fr); gap: 16px; }
.account-session div { min-width: 0; display: grid; gap: 4px; }
.account-session span { display: flex; align-items: center; gap: 4px; color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.account-session strong, .account-session code { overflow: hidden; color: var(--md-sys-color-on-surface); font-size: 11px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.account-session code { font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
.connection-address { display: flex; align-items: center; gap: 5px; }
.connection-address small { overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-size: 9px; font-weight: 500; text-overflow: ellipsis; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
.summary-item { min-width: 0; min-height: 76px; display: flex; align-items: center; gap: 12px; padding: 14px 16px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface-container); }
.summary-item > div { min-width: 0; display: grid; gap: 2px; }
.summary-item strong { font-size: 21px; line-height: 1; }
.summary-item div span { color: var(--md-sys-color-on-surface-variant); font-size: 11px; }
.summary-icon { width: 36px; height: 36px; display: grid; place-items: center; flex: 0 0 36px; border-radius: 8px; }
.summary-icon md-icon { --md-icon-size: 20px; }
.summary-icon--online { color: var(--act-success); background: color-mix(in srgb, var(--act-success) 11%, transparent); }
.summary-icon--login { color: var(--act-info); background: color-mix(in srgb, var(--act-info) 11%, transparent); }
.summary-icon--today { color: var(--act-warning); background: color-mix(in srgb, var(--act-warning) 11%, transparent); }
.summary-icon--device { color: var(--md-sys-color-primary); background: var(--md-sys-color-primary-container); }
.activity-workspace { min-width: 0; display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 14px; align-items: start; }
.member-panel, .records-panel { min-width: 0; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface-container); }
.member-panel { position: sticky; top: calc(var(--app-bar-height) + 16px); overflow: hidden; }
.panel-heading { min-height: 62px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.panel-heading > div { min-width: 0; display: grid; gap: 2px; }
.panel-heading h2 { margin: 0; font-size: 14px; font-weight: 650; }
.panel-heading span { color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.panel-heading > md-icon { color: var(--md-sys-color-on-surface-variant); }
.member-list { max-height: min(650px, calc(100vh - var(--app-bar-height) - 150px)); overflow: auto; padding: 6px; scrollbar-width: thin; }
.member-item { width: 100%; min-height: 58px; display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 7px 9px; border: 0; border-radius: 6px; color: var(--md-sys-color-on-surface); background: transparent; font: inherit; text-align: left; cursor: pointer; transition: background-color 140ms ease, color 140ms ease; }
.member-item:hover { background: color-mix(in srgb, var(--md-sys-color-primary) 7%, transparent); }
.member-item--selected { color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); }
.member-avatar-wrap { position: relative; width: 36px; height: 36px; }
.member-avatar { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; object-fit: cover; }
.member-avatar--fallback { background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface-variant); font-size: 12px; font-weight: 700; }
.member-avatar--all { color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container-high); }
.member-avatar--all md-icon { --md-icon-size: 20px; }
.member-item--selected .member-avatar--fallback, .member-item--selected .member-avatar--all { color: var(--md-sys-color-on-primary-container); background: color-mix(in srgb, var(--md-sys-color-on-primary-container) 10%, transparent); }
.presence-dot { position: absolute; right: -1px; bottom: -1px; width: 10px; height: 10px; border: 2px solid var(--md-sys-color-surface-container); border-radius: 50%; }
.presence-dot--online { background: var(--act-success); }
.presence-dot--idle { background: var(--act-warning); }
.presence-dot--offline { background: var(--md-sys-color-outline); }
.member-copy { min-width: 0; display: grid; gap: 3px; }
.member-copy strong { min-width: 0; display: flex; align-items: center; gap: 5px; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.member-copy strong em { padding: 2px 4px; border-radius: 3px; color: var(--act-success); background: color-mix(in srgb, var(--act-success) 10%, transparent); font-size: 8px; font-style: normal; }
.member-copy small { overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.member-item--selected .member-copy small { color: color-mix(in srgb, var(--md-sys-color-on-primary-container) 72%, transparent); }
.member-count { min-width: 22px; color: var(--md-sys-color-on-surface-variant); font-size: 10px; text-align: right; }
.member-item--selected .member-count { color: var(--md-sys-color-on-primary-container); }
.records-panel { overflow: hidden; }
.records-heading { border-bottom: 0; }
.record-controls { display: flex; align-items: center; gap: 10px; padding: 0 16px 14px; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.record-search { min-width: 180px; flex: 1; }
.mode-control { height: 40px; display: inline-grid; grid-auto-flow: column; grid-auto-columns: max-content; align-items: center; padding: 3px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 7px; background: var(--md-sys-color-surface); }
.mode-control button { height: 32px; padding: 0 11px; border: 0; border-radius: 5px; color: var(--md-sys-color-on-surface-variant); background: transparent; font-family: inherit; font-size: 11px; font-weight: 500; cursor: pointer; }
.mode-control button:hover { color: var(--md-sys-color-on-surface); background: var(--md-sys-color-surface-container-high); }
.mode-control .mode-button--active { color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); }
.loading-state, .empty-state { min-height: 280px; display: grid; place-items: center; align-content: center; gap: 12px; color: var(--md-sys-color-on-surface-variant); }
.empty-state > md-icon { --md-icon-size: 34px; }
.empty-state strong { font-size: 13px; }
.record-groups { padding: 0 16px 10px; }
.day-heading { height: 44px; display: flex; align-items: center; gap: 10px; color: var(--md-sys-color-on-surface-variant); font-size: 10px; font-weight: 700; }
.day-heading i { height: 1px; flex: 1; background: var(--md-sys-color-outline-variant); }
.record-item { min-width: 0; display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 11px; padding: 13px 0; border-bottom: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 72%, transparent); }
.record-item:last-child { border-bottom: 0; }
.record-marker { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 8px; }
.record-marker md-icon { --md-icon-size: 18px; }
.record-marker--action { color: var(--act-info); background: color-mix(in srgb, var(--act-info) 10%, transparent); }
.record-marker--login { color: var(--act-success); background: color-mix(in srgb, var(--act-success) 10%, transparent); }
.record-marker--logout { color: var(--act-warning); background: color-mix(in srgb, var(--act-warning) 10%, transparent); }
.record-body { min-width: 0; display: grid; gap: 7px; }
.record-title-row { min-width: 0; display: flex; align-items: center; gap: 7px; }
.record-title-row strong { min-width: 0; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.record-kind { flex: 0 0 auto; padding: 3px 6px; border-radius: 4px; font-size: 8px; font-weight: 700; }
.record-kind--action { color: var(--act-info); background: color-mix(in srgb, var(--act-info) 9%, transparent); }
.record-kind--login { color: var(--act-success); background: color-mix(in srgb, var(--act-success) 9%, transparent); }
.record-kind--logout { color: var(--act-warning); background: color-mix(in srgb, var(--act-warning) 9%, transparent); }
.record-actor { min-width: 0; display: flex; align-items: center; gap: 6px; color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.mini-avatar { width: 18px; height: 18px; display: grid; place-items: center; flex: 0 0 18px; border-radius: 50%; color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); font-size: 7px; font-weight: 700; }
.record-actor span:not(.mini-avatar), .record-actor small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.record-actor small { color: var(--md-sys-color-outline); }
.record-detail { min-width: 0; display: flex; align-items: center; gap: 6px; color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.record-detail md-icon { --md-icon-size: 15px; flex: 0 0 auto; }
.record-detail span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.record-meta { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.record-meta code { font: 9px 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
.method-code { padding: 3px 5px; border-radius: 3px; color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); font-weight: 700 !important; }
.path-code { max-width: min(100%, 440px); overflow: hidden; color: var(--md-sys-color-on-surface-variant); text-overflow: ellipsis; white-space: nowrap; }
.record-meta span { min-width: 0; display: inline-flex; align-items: center; gap: 2px; color: var(--md-sys-color-on-surface-variant); }
.record-meta span md-icon { --md-icon-size: 13px; }
.record-meta span small { color: var(--md-sys-color-on-surface-variant); font-size: 9px; }
.record-item > time { display: grid; justify-items: end; align-content: start; gap: 3px; white-space: nowrap; }
.record-item > time strong { font-size: 10px; }
.record-item > time span { color: var(--md-sys-color-on-surface-variant); font-size: 8px; }
@keyframes refresh-spin { to { transform: rotate(360deg); } }
@media (max-width: 1000px) {
  .account-status { grid-template-columns: minmax(220px, 1fr) auto; }
  .account-session { grid-column: 1 / -1; padding-top: 14px; border-top: 1px solid var(--md-sys-color-outline-variant); }
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .activity-workspace { grid-template-columns: minmax(0, 1fr); }
  .member-panel { position: static; }
  .member-list { max-height: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .member-item--all { grid-column: 1 / -1; }
  .record-controls { align-items: stretch; flex-direction: column; }
  .mode-control { width: 100%; grid-auto-columns: 1fr; }
  .mode-control button { padding: 0 6px; }
}
@media (max-width: 560px) {
  .account-status { grid-template-columns: minmax(0, 1fr); gap: 14px; padding: 16px; }
  .account-states { grid-row: 2; }
  .account-session { grid-column: auto; grid-template-columns: minmax(0, 1fr); gap: 10px; padding-top: 12px; }
  .summary-grid { gap: 8px; }
  .summary-item { min-height: 66px; gap: 9px; padding: 11px; }
  .summary-icon { width: 32px; height: 32px; flex-basis: 32px; }
  .summary-item strong { font-size: 18px; }
  .member-list { grid-template-columns: minmax(0, 1fr); }
  .member-item--all { grid-column: auto; }
  .record-groups { padding-inline: 12px; }
  .record-item { grid-template-columns: 32px minmax(0, 1fr); }
  .record-item > time { grid-column: 2; grid-row: 2; justify-items: start; grid-auto-flow: column; justify-content: start; gap: 7px; }
  .record-title-row { align-items: flex-start; flex-direction: column; gap: 5px; }
  .record-title-row strong { white-space: normal; overflow-wrap: anywhere; }
  .path-code { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
}
@media (prefers-reduced-motion: reduce) { .refresh-icon--active { animation: none; } }
</style>
