<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

useHead({ title: '游戏统计' })

interface GameStatsAccount {
  username: string
  uuid: string | null
  registered: boolean
  stats: Record<string, number>
  last_updated: number
  uploaded_at: number
}

interface GameStatsOrphan {
  uuid: string
  username: string
  stats: Record<string, number>
  last_updated: number
  uploaded_at: number
}

interface Overview {
  accounts: GameStatsAccount[]
  orphans: GameStatsOrphan[]
}

interface StatsInstance {
  instanceUuid: string
  daemonId: string
  nickname: string
  status: number
  statusLabel: string
  hostIp: string
  remarks: string
}

const METRICS = [
  ['play_time', '在线时间'],
  ['total_world_time', '世界时间'],
  ['time_since_death', '距上次死亡'],
  ['time_since_rest', '距上次休息'],
  ['sneak_time', '潜行时间'],
  ['jumps', '跳跃次数'],
  ['deaths', '死亡次数'],
  ['mob_kills', '击杀怪物'],
  ['player_kills', '击杀玩家'],
  ['damage_dealt', '造成伤害'],
  ['damage_dealt_absorbed', '造成且被吸收的伤害'],
  ['damage_dealt_resisted', '造成且被抵抗的伤害'],
  ['damage_blocked_by_shield', '盾牌格挡伤害'],
  ['damage_absorbed', '吸收伤害'],
  ['damage_resisted', '抵抗伤害'],
  ['damage_taken', '受到伤害'],
  ['walk_cm', '步行距离'],
  ['crouch_cm', '潜行距离'],
  ['sprint_cm', '疾跑距离'],
  ['walk_on_water_cm', '水面行走距离'],
  ['walk_under_water_cm', '水下行走距离'],
  ['climb_cm', '攀爬距离'],
  ['fly_cm', '飞行距离'],
  ['swim_cm', '游泳距离'],
  ['aviate_cm', '鞘翅飞行距离'],
  ['minecart_cm', '矿车移动距离'],
  ['boat_cm', '船移动距离'],
  ['pig_cm', '骑猪移动距离'],
  ['happy_ghast_cm', '骑快乐恶魂移动距离'],
  ['horse_cm', '骑马移动距离'],
  ['strider_cm', '骑炽足兽移动距离'],
  ['nautilus_cm', '骑鹦鹉螺移动距离'],
  ['fall_cm', '坠落距离'],
  ['fish_caught', '钓鱼数量'],
  ['talked_to_villager', '与村民交谈'],
  ['traded', '村民交易次数'],
  ['items_dropped', '丢弃物品'],
  ['sleep_in_bed', '睡觉次数'],
  ['enchanted', '附魔次数'],
  ['fill_cauldron', '填充炼药锅'],
  ['use_cauldron', '使用炼药锅'],
  ['clean_armor', '清洗盔甲'],
  ['clean_banner', '清洗旗帜'],
  ['clean_shulker_box', '清洗潜影盒'],
  ['interact_with_brewingstand', '使用酿造台'],
  ['interact_with_beacon', '使用信标'],
  ['inspect_dropper', '检查投掷器'],
  ['inspect_hopper', '检查漏斗'],
  ['inspect_dispenser', '检查发射器'],
  ['play_noteblock', '播放音符盒'],
  ['tune_noteblock', '调整音符盒音调'],
  ['pot_flower', '给花盆放置植物'],
  ['trigger_trapped_chest', '触发陷阱箱'],
  ['open_enderchest', '打开末影箱'],
  ['open_shulker_box', '打开潜影盒'],
  ['open_barrel', '打开木桶'],
  ['play_record', '播放唱片'],
  ['interact_with_furnace', '使用熔炉'],
  ['interact_with_crafting_table', '使用工作台'],
  ['open_chest', '打开普通箱子'],
  ['interact_with_blast_furnace', '使用高炉'],
  ['interact_with_smoker', '使用烟熏炉'],
  ['interact_with_lectern', '使用讲台'],
  ['interact_with_campfire', '使用营火'],
  ['interact_with_cartography_table', '使用制图台'],
  ['interact_with_loom', '使用织布机'],
  ['interact_with_stonecutter', '使用切石机'],
  ['raid_trigger', '触发袭击'],
  ['target_hit', '命中靶子'],
  ['raid_wins', '袭击胜利'],
  ['animals_bred', '繁殖动物'],
  ['bell_ring', '敲钟次数'],
  ['cake_eaten', '吃蛋糕'],
  ['interact_with_anvil', '使用铁砧'],
  ['interact_with_grindstone', '使用砂轮'],
  ['interact_with_smithing_table', '使用锻造台'],
  ['redstone_placed', '红石相关物品使用'],
] as const

const route = useRoute()
const access = useAdminAccess()
const { showToast } = useToast()
const overview = ref<Overview>({ accounts: [], orphans: [] })
const loading = ref(false)
const keyword = ref('')
const selectedUsername = ref<string | null>(null)
const instances = ref<StatsInstance[]>([])
const instancesConfigured = ref(false)
const instancesLoading = ref(false)
const syncing = ref(false)
const selectedInstanceKey = ref('')

const canSync = computed(() => access.featureLevelForKey('game-stats-sync') === 'edit')

function instanceKey(instance: StatsInstance) {
  return `${instance.instanceUuid}:${instance.daemonId}`
}

const selectedInstance = computed(() => instances.value.find(
  instance => instanceKey(instance) === selectedInstanceKey.value,
) ?? null)

const syncButtonTitle = computed(() => {
  if (instancesLoading.value) return '正在读取服务器实例'
  if (!instancesConfigured.value) return '请先配置 MCSM 面板'
  if (!selectedInstance.value) return '没有可用的服务器实例'
  if (selectedInstance.value.status !== 3) return '服务器未运行，无法拉取统计'
  return '立即向 Minecraft 服务器拉取统计数据'
})

const filteredAccounts = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase('zh-CN')
  if (!query) return overview.value.accounts
  return overview.value.accounts.filter((account) => account.username.toLocaleLowerCase('zh-CN').includes(query)
    || String(account.uuid || '').toLowerCase().includes(query))
})

const selectedAccount = computed(() => overview.value.accounts
  .find((account) => account.username === selectedUsername.value) ?? null)

const uploadedCount = computed(() => overview.value.accounts.filter((account) => account.uploaded_at > 0).length)

function formatTime(timestamp: number) {
  if (!timestamp) return '尚未上传'
  return new Date(timestamp).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatNumber(value: number | undefined) {
  return new Intl.NumberFormat('zh-CN').format(Number.isSafeInteger(value) ? value : 0)
}

function selectAccount(account: GameStatsAccount) {
  selectedUsername.value = account.username
}

async function loadOverview() {
  loading.value = true
  try {
    overview.value = await $fetch<Overview>('/api/admin/game-stats')
    const requested = typeof route.query.username === 'string' ? route.query.username : ''
    const preferred = overview.value.accounts.find((account) => account.username === requested)
    if (preferred) selectedUsername.value = preferred.username
    else if (!selectedUsername.value && overview.value.accounts.length) selectedUsername.value = overview.value.accounts[0].username
    else if (selectedUsername.value && !overview.value.accounts.some((account) => account.username === selectedUsername.value)) {
      selectedUsername.value = null
    }
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '游戏统计加载失败', 'error')
  } finally {
    loading.value = false
  }
}

async function loadSyncInstances() {
  if (!canSync.value) return
  instancesLoading.value = true
  try {
    const result = await $fetch<{ configured: boolean; instances: StatsInstance[] }>('/api/admin/game-stats/instances')
    instancesConfigured.value = result.configured
    instances.value = result.instances || []
    const current = instances.value.find(instance => instanceKey(instance) === selectedInstanceKey.value)
    const running = instances.value.find(instance => instance.status === 3)
    selectedInstanceKey.value = current ? instanceKey(current) : (running ? instanceKey(running) : '')
  } catch (error: any) {
    instancesConfigured.value = false
    instances.value = []
    selectedInstanceKey.value = ''
    showToast(error?.data?.statusMessage || 'MCSM 实例加载失败', 'error')
  } finally {
    instancesLoading.value = false
  }
}

async function syncNow() {
  const instance = selectedInstance.value
  if (!instance || instance.status !== 3 || syncing.value) return
  syncing.value = true
  try {
    await $fetch('/api/admin/game-stats/sync', {
      method: 'POST',
      body: { uuid: instance.instanceUuid, daemonId: instance.daemonId },
    })
    showToast('已向服务器发送统计上传指令')
    await loadOverview()
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '统计上传指令发送失败', 'error')
  } finally {
    syncing.value = false
  }
}

onMounted(async () => {
  try {
    await access.load(true)
    await Promise.all([loadOverview(), loadSyncInstances()])
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '游戏统计初始化失败', 'error')
  }
})
</script>

<template>
  <div class="page page--wide api-redesign-page game-stats-page">
    <div class="page-heading">
      <div>
        <h1 class="page-title">游戏统计</h1>
        <p class="page-description">按游戏 UUID 绑定账户，查看模组每 6 小时上传的累计数据。</p>
      </div>
      <div class="heading-actions">
        <md-outlined-select
          v-if="canSync && instances.length > 1"
          class="instance-select"
          label="服务器"
          :value="selectedInstanceKey"
          :disabled="instancesLoading || syncing"
          @change="selectedInstanceKey = ($event.target as HTMLSelectElement).value"
        >
          <md-select-option
            v-for="instance in instances"
            :key="instanceKey(instance)"
            :value="instanceKey(instance)"
            :selected="instanceKey(instance) === selectedInstanceKey"
          >
            <div slot="headline">{{ instance.nickname || instance.instanceUuid }}</div>
            <div slot="supporting-text">{{ instance.statusLabel }} · {{ instance.hostIp || instance.remarks || instance.daemonId }}</div>
          </md-select-option>
        </md-outlined-select>
        <md-filled-button
          v-if="canSync"
          class="sync-button"
          :disabled="syncing || instancesLoading || !selectedInstance || selectedInstance.status !== 3"
          :title="syncButtonTitle"
          @click="syncNow"
        >
          <md-icon slot="icon" :class="{ 'refresh-icon--loading': syncing }">cloud_sync</md-icon>
          {{ syncing ? '拉取中…' : '立即拉取' }}
        </md-filled-button>
        <md-icon-button aria-label="刷新" title="刷新" :disabled="loading" @click="loadOverview">
          <md-icon :class="{ 'refresh-icon--loading': loading }">refresh</md-icon>
        </md-icon-button>
      </div>
    </div>

    <section class="overview-grid" aria-label="统计概览">
      <div class="summary-item">
        <span class="summary-label">游戏账户</span>
        <strong>{{ overview.accounts.length }}</strong>
        <span class="summary-note">已绑定的账户总数</span>
      </div>
      <div class="summary-item summary-item--accent">
        <span class="summary-label">已有上传</span>
        <strong>{{ uploadedCount }}</strong>
        <span class="summary-note">最近有统计记录</span>
      </div>
      <div class="summary-item" :class="{ 'summary-item--warning': overview.orphans.length }">
        <span class="summary-label">未绑定记录</span>
        <strong>{{ overview.orphans.length }}</strong>
        <span class="summary-note">未匹配游戏账户的 UUID</span>
      </div>
    </section>

    <div class="stats-layout">
      <section class="card account-panel">
        <div class="panel-heading account-panel-heading">
          <div>
            <span class="section-overline">账户目录</span>
            <h2>玩家账户</h2>
          </div>
          <span class="result-count">{{ filteredAccounts.length }} 个结果</span>
        </div>
        <div class="account-filter">
          <md-outlined-text-field
            class="search-field"
            label="搜索玩家或 UUID"
            :value="keyword"
            @input="keyword = ($event.target as HTMLInputElement).value"
          >
            <md-icon slot="leading-icon">search</md-icon>
          </md-outlined-text-field>
        </div>
        <div v-if="loading" class="empty">加载中…</div>
        <EmptyState v-else-if="!overview.accounts.length" image="/images/empty-profile.svg">
          <template #title>暂无游戏账户</template>
          还没有可查看的游戏账户统计。
        </EmptyState>
        <EmptyState v-else-if="!filteredAccounts.length" image="/images/empty-looking-for-answers.svg">
          <template #title>没有匹配的账户</template>
          请尝试搜索其他玩家名或 UUID。
        </EmptyState>
        <div v-else class="account-list" role="listbox" aria-label="游戏账户列表">
          <button
            v-for="account in filteredAccounts"
            :key="account.username"
            type="button"
            class="account-row"
            :class="{ selected: account.username === selectedUsername }"
            role="option"
            :aria-selected="account.username === selectedUsername"
            @click="selectAccount(account)"
          >
            <span class="account-identity">
              <strong>{{ account.username }}</strong>
              <span class="subline mono">{{ account.uuid || '未绑定 UUID' }}</span>
            </span>
            <span class="account-status">
              <span class="status-badge" :class="{ active: account.uploaded_at > 0 }">
                <span class="status-dot"></span>
                {{ account.uploaded_at > 0 ? '已上传' : '尚未上传' }}
              </span>
            </span>
            <span class="account-last-upload muted">
              <span class="cell-label">最近上传</span>
              {{ formatTime(account.uploaded_at) }}
            </span>
          </button>
        </div>
      </section>

      <section class="card detail-panel">
        <EmptyState v-if="!selectedAccount" class="detail-empty" image="/images/empty-looking-for-answers.svg">
          <template #title>选择账户查看统计</template>
          从左侧账户目录选择玩家后，这里会显示累计数据。
        </EmptyState>
        <template v-else>
          <div class="panel-heading detail-heading">
            <div>
              <span class="section-overline">统计详情</span>
              <h2>{{ selectedAccount.username }}</h2>
              <div class="muted mono detail-uuid">{{ selectedAccount.uuid || '未绑定 UUID' }}</div>
            </div>
            <span class="account-badge" :class="{ registered: selectedAccount.registered }">
              {{ selectedAccount.registered ? '已注册' : '未注册' }}
            </span>
          </div>
          <div class="detail-meta">
            <div class="meta-item">
              <span class="meta-label">统计更新时间</span>
              <strong>{{ formatTime(selectedAccount.last_updated) }}</strong>
            </div>
            <div class="meta-item">
              <span class="meta-label">上传时间</span>
              <strong>{{ formatTime(selectedAccount.uploaded_at) }}</strong>
            </div>
          </div>
          <EmptyState v-if="selectedAccount.uploaded_at === 0" class="detail-empty" image="/images/empty-monitoring-data.svg">
            <template #title>暂无统计上传</template>
            该账户还没有可查看的统计数据。
          </EmptyState>
          <div v-else class="metric-grid">
            <div v-for="([key, label]) in METRICS" :key="key" class="metric-block">
              <span>{{ label }}</span>
              <strong>{{ formatNumber(selectedAccount.stats[key]) }}</strong>
            </div>
          </div>
        </template>
      </section>
    </div>

    <section v-if="overview.orphans.length" class="card orphan-card">
      <div class="panel-heading orphan-heading">
        <div>
          <span class="section-overline">需要关注</span>
          <h2>未绑定统计</h2>
        </div>
        <span class="result-count">{{ overview.orphans.length }} 条记录</span>
      </div>
      <p class="muted orphan-description">这些 UUID 在游戏账户表中没有对应记录，通常表示账户已注销或绑定信息尚未同步。</p>
      <div class="orphan-list">
        <div v-for="orphan in overview.orphans" :key="orphan.uuid" class="orphan-row">
          <span class="mono orphan-uuid">{{ orphan.uuid }}</span>
          <span>{{ orphan.username }}</span>
          <span class="muted orphan-upload-time">{{ formatTime(orphan.uploaded_at) }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.game-stats-page .page-title::before { content: '数据中心'; }
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.page-heading > div:first-child { min-width: 0; }
.heading-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }
.instance-select { width: 190px; }
.sync-button { white-space: nowrap; }
.page-description { margin: 5px 0 0; color: var(--api-text-muted); font-size: 13px; line-height: 1.5; }
.overview-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
.summary-item { min-width: 0; padding: 16px 18px; border: 1px solid var(--api-border); border-radius: 8px; background: var(--api-surface-muted); }
.summary-item strong { display: block; margin-top: 5px; color: var(--api-text); font-size: 25px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
.summary-label, .summary-note { display: block; color: var(--api-text-muted); font-size: 12px; }
.summary-label { font-weight: 700; }
.summary-note { margin-top: 6px; font-size: 11px; }
.summary-item--accent { border-color: color-mix(in srgb, var(--md-sys-color-primary) 36%, var(--api-border)); background: color-mix(in srgb, var(--md-sys-color-primary) 7%, var(--api-surface-muted)); }
.summary-item--accent .summary-label, .summary-item--accent strong { color: var(--md-sys-color-primary); }
.summary-item--warning { border-color: color-mix(in srgb, var(--md-sys-color-error) 35%, var(--api-border)); }
.summary-item--warning strong { color: var(--md-sys-color-error); }
.stats-layout { display: grid; grid-template-columns: minmax(390px, 0.92fr) minmax(0, 1.35fr); gap: 14px; align-items: start; }
.account-panel, .detail-panel, .orphan-card { overflow: hidden; }
.account-panel { min-width: 0; padding: 0; }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; min-height: 48px; padding: 18px 20px 13px; border-bottom: 1px solid color-mix(in srgb, var(--api-border) 72%, transparent); }
.panel-heading h2 { margin: 3px 0 0; font-size: 18px; line-height: 1.25; }
.section-overline { display: block; color: var(--md-sys-color-primary); font-size: 11px; font-weight: 750; line-height: 1.2; }
.result-count { flex: 0 0 auto; padding-top: 3px; color: var(--api-text-muted); font-size: 12px; white-space: nowrap; }
.account-filter { padding: 14px 20px 0; }
.search-field { width: 100%; }
.account-list { display: grid; gap: 0; margin: 14px 20px 20px; border: 1px solid var(--api-border); border-radius: 8px; overflow: hidden; }
.account-row { display: grid; grid-template-columns: minmax(0, 1fr) 112px 132px; align-items: center; gap: 12px; width: 100%; padding: 13px 14px; border: 0; border-bottom: 1px solid color-mix(in srgb, var(--api-border) 74%, transparent); background: var(--api-surface); color: var(--api-text); text-align: left; font: inherit; appearance: none; cursor: pointer; }
.account-row:last-child { border-bottom: 0; }
.account-row:hover { background: color-mix(in srgb, var(--md-sys-color-primary) 6%, var(--api-surface)); }
.account-row.selected { background: color-mix(in srgb, var(--md-sys-color-primary) 11%, var(--api-surface)); box-shadow: inset 3px 0 0 var(--md-sys-color-primary); }
.account-row:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: -2px; }
.account-identity, .account-status, .account-last-upload { min-width: 0; }
.account-status { justify-self: start; }
.account-last-upload { overflow-wrap: anywhere; font-size: 12px; line-height: 1.35; }
.cell-label { display: none; margin-right: 4px; color: var(--api-text-muted); font-size: 10px; }
.subline { display: block; max-width: 100%; margin-top: 4px; color: var(--api-text-muted); font-size: 11px; font-weight: 400; overflow-wrap: anywhere; }
.status-badge { display: inline-flex; align-items: center; gap: 6px; color: var(--api-text-muted); font-size: 12px; white-space: nowrap; }
.status-badge.active { color: var(--md-sys-color-primary); }
.status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--md-sys-color-outline); }
.status-badge.active .status-dot { background: var(--md-sys-color-primary); }
.upload-time { font-size: 12px; white-space: normal; }
.detail-panel { min-width: 0; padding: 0 20px 20px; }
.detail-heading { margin: 0 -20px; padding-left: 20px; padding-right: 20px; }
.detail-heading h2 { font-size: 20px; }
.detail-uuid { margin-top: 5px; font-size: 11px; }
.account-badge { flex: 0 0 auto; padding: 4px 9px; border: 1px solid var(--api-border); border-radius: 6px; color: var(--api-text-muted); font-size: 11px; white-space: nowrap; }
.account-badge.registered { border-color: color-mix(in srgb, var(--md-sys-color-primary) 36%, var(--api-border)); color: var(--md-sys-color-primary); }
.detail-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 16px 0; }
.meta-item { min-width: 0; padding: 10px 12px; border: 1px solid var(--api-border); border-radius: 6px; background: var(--api-surface-muted); }
.meta-label { display: block; margin-bottom: 4px; color: var(--api-text-muted); font-size: 11px; }
.meta-item strong { display: block; overflow-wrap: anywhere; color: var(--api-text); font-size: 12px; font-weight: 600; }
.metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.metric-block { min-width: 0; padding: 11px 12px; border: 1px solid var(--api-border); border-radius: 6px; background: var(--api-surface); }
.metric-block span { display: block; overflow-wrap: anywhere; color: var(--api-text-muted); font-size: 11px; line-height: 1.35; }
.metric-block strong { display: block; margin-top: 6px; color: var(--api-text); font-size: 17px; line-height: 1.1; font-variant-numeric: tabular-nums; }
.empty { padding: 42px 16px; text-align: center; color: var(--api-text-muted); }
.detail-empty { min-height: 330px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
.detail-empty md-icon { color: var(--md-sys-color-primary); font-size: 30px; }
.detail-empty strong { color: var(--api-text); font-size: 14px; }
.detail-empty span { max-width: 260px; font-size: 12px; line-height: 1.5; }
.orphan-card { margin-top: 14px; padding: 0 20px 20px; }
.orphan-heading { margin: 0 -20px; }
.orphan-description { margin: 14px 0; font-size: 12px; line-height: 1.5; }
.orphan-list { display: grid; border: 1px solid var(--api-border); border-radius: 8px; overflow: hidden; }
.orphan-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(100px, 0.6fr) 150px; gap: 14px; padding: 12px 14px; border-bottom: 1px solid color-mix(in srgb, var(--api-border) 74%, transparent); font-size: 12px; }
.orphan-row:last-child { border-bottom: 0; }
.orphan-uuid { min-width: 0; overflow-wrap: anywhere; }
.orphan-upload-time { overflow-wrap: anywhere; }
.muted { color: var(--api-text-muted); }
.mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }

@media (max-width: 980px) {
  .stats-layout { grid-template-columns: 1fr; }
  .detail-empty { min-height: 220px; }
}

@media (max-width: 700px) {
  .page-heading { align-items: stretch; flex-direction: column; }
  .heading-actions { justify-content: flex-end; }
  .instance-select { flex: 1 1 180px; width: auto; min-width: 0; }
  .overview-grid { grid-template-columns: 1fr; gap: 8px; }
  .summary-item { padding: 13px 15px; }
  .summary-item strong { display: inline-block; margin: 3px 8px 0 0; font-size: 22px; }
  .summary-note { display: inline; }
  .panel-heading { padding-left: 16px; padding-right: 16px; }
  .account-filter { padding-left: 16px; padding-right: 16px; }
  .account-list { margin-left: 16px; margin-right: 16px; }
  .account-row { grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; padding: 12px; }
  .account-status { grid-column: 2; grid-row: 1; }
  .account-last-upload { grid-column: 1 / -1; grid-row: 2; padding-top: 7px; border-top: 1px solid color-mix(in srgb, var(--api-border) 58%, transparent); }
  .cell-label { display: inline; }
  .detail-panel { padding-left: 16px; padding-right: 16px; }
  .detail-heading, .orphan-heading { margin-left: -16px; margin-right: -16px; }
  .detail-meta { grid-template-columns: 1fr; }
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .orphan-card { padding-left: 16px; padding-right: 16px; }
  .orphan-row { grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; padding: 11px 12px; }
  .orphan-uuid { grid-column: 1 / -1; grid-row: 1; }
  .orphan-row > span:nth-child(2) { grid-column: 1; grid-row: 2; }
  .orphan-upload-time { grid-column: 2; grid-row: 2; text-align: right; }
}

@media (max-width: 460px) {
  .metric-grid { grid-template-columns: 1fr; }
  .status-badge { font-size: 11px; }
}
</style>
