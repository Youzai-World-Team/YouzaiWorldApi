<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

useHead({ title: '账户装扮' })

interface LocalSlot {
  slot: string
  sha256: string
  bytes: number
  width: number
  height: number
  updated_at: number
}

interface MojangInfo {
  status: 'premium' | 'missing' | 'error'
  username: string
  uuid: string | null
  skin_hash: string | null
  cape_hash: string | null
  model: 'classic' | 'slim' | null
  message: string
  checked_at: number
  stale: boolean
}

interface CosmeticAccount {
  username: string
  uuid: string | null
  registered: boolean
  last_authenticated_date: string
  local: {
    skin: LocalSlot | null
    cape: LocalSlot | null
    model: 'classic' | 'slim' | null
    updated_at: number
  }
  mojang: MojangInfo | null
}

interface OrphanEntry {
  uuid: string
  slots: LocalSlot[]
  updated_at: number
}

interface Overview {
  accounts: CosmeticAccount[]
  orphans: OrphanEntry[]
  mojang_lookup_disabled: boolean
}

type Source = 'local' | 'mojang' | 'none'

const SOURCE_FILTERS = [
  { value: 'all', label: '全部账户' },
  { value: 'local', label: '有离线上传' },
  { value: 'mojang', label: '仅正版档案' },
  { value: 'none', label: '没有外观' },
] as const

const SLOT_LABELS: Record<string, string> = {
  'skin.png': '皮肤（经典模型）',
  'skin_slim.png': '皮肤（纤细模型）',
  'cloak.png': '披风',
}

const route = useRoute()
const { showToast } = useToast()
const access = useAdminAccess()
const canRefresh = computed(() => access.levelForKey('game-cosmetics') === 'edit'
  && access.featureLevelForKey('game-cosmetics-refresh') === 'edit')
const { apply: applyDialogAnimation } = useDialogAnimation()

const overview = ref<Overview | null>(null)
const loading = ref(true)
const lookingUp = ref(false)
const keyword = ref('')
const sourceFilter = ref<'all' | Source>('all')
const detailUsername = ref<string | null>(null)
const detailDialog = ref<HTMLElement | null>(null)

function localTextureUrl(uuid: string, slot: string) {
  return `/api/admin/game-cosmetics/texture?uuid=${encodeURIComponent(uuid)}&slot=${encodeURIComponent(slot)}`
}

function mojangTextureUrl(hash: string) {
  return `/api/admin/game-cosmetics/mojang-texture?hash=${encodeURIComponent(hash)}`
}

const rows = computed(() => (overview.value?.accounts ?? []).map((account) => {
  const uuid = (account.uuid || '').toLowerCase()
  const local = account.local
  const mojang = account.mojang
  const premium = mojang?.status === 'premium'
  const localSkin = local.skin && uuid ? localTextureUrl(uuid, local.skin.slot) : null
  const localCape = local.cape && uuid ? localTextureUrl(uuid, 'cloak.png') : null
  const mojangSkin = premium && mojang?.skin_hash ? mojangTextureUrl(mojang.skin_hash) : null
  const mojangCape = premium && mojang?.cape_hash ? mojangTextureUrl(mojang.cape_hash) : null
  const hasLocal = Boolean(localSkin || localCape)
  const hasMojang = Boolean(mojangSkin || mojangCape)
  // 模组只下发数据库里的外观，本地有上传时它才是服务器实际生效的那一套。
  const source: Source = hasLocal ? 'local' : hasMojang ? 'mojang' : 'none'
  return {
    account,
    uuid,
    local,
    mojang,
    premium,
    hasLocal,
    hasMojang,
    localSkin,
    localCape,
    mojangSkin,
    mojangCape,
    source,
    figureSkin: hasLocal ? localSkin : mojangSkin,
    figureCape: hasLocal ? localCape : mojangCape,
    figureSlim: hasLocal ? local.model === 'slim' : mojang?.model === 'slim',
    updatedAt: hasLocal ? local.updated_at : mojang?.checked_at ?? 0,
  }
}))

type CosmeticRow = (typeof rows)['value'][number]

const filtered = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    if (sourceFilter.value !== 'all' && row.source !== sourceFilter.value) return false
    if (!text) return true
    return row.account.username.toLowerCase().includes(text) || row.uuid.includes(text)
  })
})

const orphanRows = computed(() => (overview.value?.orphans ?? []).map((entry) => {
  const skin = entry.slots.find((slot) => slot.slot !== 'cloak.png')
  const cape = entry.slots.find((slot) => slot.slot === 'cloak.png')
  return {
    entry,
    skinUrl: skin ? localTextureUrl(entry.uuid, skin.slot) : null,
    capeUrl: cape ? localTextureUrl(entry.uuid, 'cloak.png') : null,
    slim: skin?.slot === 'skin_slim.png',
  }
}))

const counts = computed(() => ({
  local: rows.value.filter((row) => row.source === 'local').length,
  mojang: rows.value.filter((row) => row.source === 'mojang').length,
  none: rows.value.filter((row) => row.source === 'none').length,
}))

const detailRow = computed<CosmeticRow | null>(() =>
  rows.value.find((row) => row.account.username === detailUsername.value) ?? null)

const detailSlots = computed<LocalSlot[]>(() => {
  const row = detailRow.value
  if (!row) return []
  return [row.local.skin, row.local.cape].filter((slot): slot is LocalSlot => Boolean(slot))
})

const lookupDisabled = computed(() => Boolean(overview.value?.mojang_lookup_disabled))

async function load() {
  loading.value = true
  try {
    overview.value = await $fetch<Overview>('/api/admin/game-cosmetics')
  } catch (error: any) {
    showToast(error?.data?.message || error?.data?.statusMessage || '外观数据加载失败', 'error')
  } finally {
    loading.value = false
  }
  await lookupMojang(false)
}

/**
 * 向 Mojang 查询正版档案。refresh 为假时只补齐缺失或已过期的账户，
 * 一次最多 60 个代号，按批提交，避免把 Mojang 的名称查询配额打满。
 */
async function lookupMojang(refresh: boolean) {
  if (lookupDisabled.value || lookingUp.value || (refresh && !canRefresh.value)) return
  const accounts = overview.value?.accounts ?? []
  const targets = accounts
    .filter((account) => refresh || !account.mojang || account.mojang.stale)
    .map((account) => account.username)
  if (!targets.length) {
    if (refresh) showToast('没有需要查询的账户')
    return
  }

  lookingUp.value = true
  let failures = 0
  try {
    for (let index = 0; index < targets.length; index += 60) {
      const chunk = targets.slice(index, index + 60)
      try {
        const result = await $fetch<{ profiles: Record<string, MojangInfo> }>(
          '/api/admin/game-cosmetics/lookup',
          { method: 'POST', body: { usernames: chunk, refresh } },
        )
        applyProfiles(result.profiles)
      } catch (error: any) {
        failures += 1
        if (failures === 1) {
          showToast(error?.data?.message || error?.data?.statusMessage || '正版档案查询失败', 'error')
        }
      }
    }
    if (refresh && !failures) showToast('正版档案已刷新')
  } finally {
    lookingUp.value = false
  }
}

function applyProfiles(profiles: Record<string, MojangInfo>) {
  const current = overview.value
  if (!current) return
  current.accounts = current.accounts.map((account) => {
    const profile = profiles[account.username.toLowerCase()]
    return profile ? { ...account, mojang: profile } : account
  })
}

async function refreshOne(username: string) {
  if (lookupDisabled.value || !canRefresh.value) return
  try {
    const result = await $fetch<{ profiles: Record<string, MojangInfo> }>(
      '/api/admin/game-cosmetics/lookup',
      { method: 'POST', body: { usernames: [username], refresh: true } },
    )
    applyProfiles(result.profiles)
    showToast(`${username} 的正版档案已刷新`)
  } catch (error: any) {
    showToast(error?.data?.message || error?.data?.statusMessage || '正版档案查询失败', 'error')
  }
}

function openDetail(row: CosmeticRow) {
  detailUsername.value = row.account.username
}

function sourceLabel(row: CosmeticRow) {
  if (row.source === 'local') return '离线上传'
  if (row.source === 'mojang') return '正版档案'
  return '无外观'
}

function mojangLabel(mojang: MojangInfo | null) {
  if (lookupDisabled.value) return '已关闭正版查询'
  if (!mojang) return '未查询'
  if (mojang.status === 'missing') return 'Mojang 无同名账户'
  if (mojang.status === 'error') return mojang.message || '查询失败'
  return mojang.skin_hash ? '存在同名正版账户' : '正版账户（默认皮肤）'
}

function modelLabel(slim: boolean | undefined, present: boolean) {
  if (!present) return '—'
  return slim ? '纤细（3px 手臂）' : '经典（4px 手臂）'
}

function formatBytes(bytes: number) {
  if (!bytes) return '—'
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '—'
  return new Date(value).toLocaleString('zh-CN')
}

function slotLabel(slot: string) {
  return SLOT_LABELS[slot] || slot
}

function onSourceFilterChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'all' || value === 'local' || value === 'mojang' || value === 'none') {
    sourceFilter.value = value
  }
}

// 从「游戏账户」页跳转过来时带着 ?username=，直接筛出并打开该账户的详情。
// 只在数据首次到位时生效一次，避免刷新正版档案后又把关掉的弹窗顶出来。
let deepLinkPending = true
watch([rows, () => route.query.username], ([list, username]) => {
  if (!deepLinkPending) return
  const target = String(username ?? '').trim()
  if (!target || !list.length) return
  const matched = list.find((row) => row.account.username.toLowerCase() === target.toLowerCase())
  if (!matched) return
  deepLinkPending = false
  keyword.value = matched.account.username
  detailUsername.value = matched.account.username
}, { immediate: true })

onMounted(() => {
  load()
  applyDialogAnimation(detailDialog.value)
})
</script>

<template>
  <div class="page">
    <div class="page-heading">
      <h1 class="page-title">账户装扮</h1>
      <div class="heading-actions">
        <md-filled-tonal-button
          v-if="canRefresh"
          :disabled="loading || lookingUp || lookupDisabled"
          @click="lookupMojang(true)"
        >
          <md-icon slot="icon">cloud_sync</md-icon>
          {{ lookingUp ? '查询中…' : '刷新正版档案' }}
        </md-filled-tonal-button>
        <md-icon-button aria-label="刷新" title="刷新" :disabled="loading" @click="load">
          <md-icon :class="{ 'refresh-icon--loading': loading }">refresh</md-icon>
        </md-icon-button>
      </div>
    </div>

    <p v-if="lookupDisabled" class="notice">
      本实例设置了 YZWC_MOJANG_DISABLED=1，已关闭对 Mojang 的外呼，只展示离线上传的外观。
    </p>

    <section class="card">
      <div class="toolbar">
        <md-outlined-text-field
          class="search"
          label="搜索玩家代号 / UUID"
          :value="keyword"
          @input="keyword = ($event.target as HTMLInputElement).value"
        >
          <md-icon slot="leading-icon">search</md-icon>
        </md-outlined-text-field>
        <md-outlined-select class="filter" label="来源" @change="onSourceFilterChange">
          <md-select-option
            v-for="option in SOURCE_FILTERS"
            :key="option.value"
            :value="option.value"
            :selected="option.value === sourceFilter"
          >
            <div slot="headline">{{ option.label }}</div>
          </md-select-option>
        </md-outlined-select>
        <span class="count">
          共 {{ rows.length }} 个账户：离线上传 {{ counts.local }} · 正版档案 {{ counts.mojang }} · 无外观 {{ counts.none }}
        </span>
      </div>

      <p v-if="loading" class="empty">加载中…</p>
      <p v-else-if="!rows.length" class="empty">暂无游戏账户</p>
      <p v-else-if="!filtered.length" class="empty">没有匹配的账户</p>
      <div v-else class="grid">
        <article
          v-for="row in filtered"
          :key="row.account.username"
          class="figure-card"
          :class="`figure-card--${row.source}`"
        >
          <div class="figure-pair">
            <SkinFigure
              :skin="row.figureSkin"
              :slim="row.figureSlim"
              :pixel-size="4"
              view="front"
              :label="`${row.account.username} 正面`"
            />
            <SkinFigure
              :skin="row.figureSkin"
              :cape="row.figureCape"
              :slim="row.figureSlim"
              :pixel-size="4"
              view="back"
              :label="`${row.account.username} 背面`"
            />
          </div>
          <div class="figure-info">
            <h2 class="figure-name">{{ row.account.username }}</h2>
            <p class="mono figure-uuid" :title="row.uuid">{{ row.uuid || '未绑定 UUID' }}</p>
            <div class="badges">
              <span class="badge" :class="`badge-${row.source}`">{{ sourceLabel(row) }}</span>
              <span v-if="row.figureCape" class="badge">有披风</span>
              <span v-if="row.figureSkin" class="badge">{{ row.figureSlim ? '纤细' : '经典' }}</span>
              <span v-if="row.hasLocal && row.hasMojang" class="badge badge-hint">另有正版档案</span>
            </div>
            <p class="figure-meta">
              {{ row.source === 'local' ? '上传时间' : '查询时间' }}：{{ formatTime(row.updatedAt) }}
            </p>
            <div class="figure-actions">
              <md-text-button @click="openDetail(row)">
                <md-icon slot="icon">visibility</md-icon>
                查看详情
              </md-text-button>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section v-if="orphanRows.length" class="card">
      <h2 class="section-heading">未关联账户的外观数据（{{ orphanRows.length }}）</h2>
      <p class="section-hint">
        这些 UUID 在 game_cosmetics 里还有数据，但账户表里已经没有对应账户，通常是注销时删除外观失败留下的残留。
      </p>
      <div class="grid">
        <article v-for="item in orphanRows" :key="item.entry.uuid" class="figure-card">
          <div class="figure-pair">
            <SkinFigure :skin="item.skinUrl" :slim="item.slim" :pixel-size="4" view="front" />
            <SkinFigure :skin="item.skinUrl" :cape="item.capeUrl" :slim="item.slim" :pixel-size="4" view="back" />
          </div>
          <div class="figure-info">
            <p class="mono figure-uuid" :title="item.entry.uuid">{{ item.entry.uuid }}</p>
            <div class="badges">
              <span v-for="slot in item.entry.slots" :key="slot.slot" class="badge">{{ slotLabel(slot.slot) }}</span>
            </div>
            <p class="figure-meta">上传时间：{{ formatTime(item.entry.updated_at) }}</p>
          </div>
        </article>
      </div>
    </section>

    <md-dialog
      ref="detailDialog"
      class="cosmetic-detail-dialog"
      :open="!!detailUsername"
      @closed="detailUsername = null"
    >
      <div slot="headline">装扮预览 · {{ detailRow?.account.username || '账户' }}</div>
      <div slot="content">
        <div v-if="detailRow" class="detail">
          <header class="detail-summary">
            <div class="detail-avatar">
              <SkinFigure
                :skin="detailRow.figureSkin"
                :slim="detailRow.figureSlim"
                :pixel-size="8"
                view="head"
                :label="`${detailRow.account.username} 头像`"
              />
            </div>
            <div class="detail-identity">
              <h2>{{ detailRow.account.username }}</h2>
              <p class="mono" :title="detailRow.uuid">{{ detailRow.uuid || '未绑定 UUID' }}</p>
              <div class="badges">
                <span class="badge" :class="`badge-${detailRow.source}`">{{ sourceLabel(detailRow) }}</span>
                <span class="badge">{{ detailRow.account.registered ? '已注册账户' : '未注册账户' }}</span>
                <span v-if="detailRow.figureSkin" class="badge">{{ detailRow.figureSlim ? '纤细模型' : '经典模型' }}</span>
                <span v-if="detailRow.figureCape" class="badge">有披风</span>
              </div>
            </div>
            <dl class="summary-facts">
              <div><dt>服务器外观</dt><dd>{{ detailRow.hasLocal ? '已上传并生效' : '没有上传' }}</dd></div>
              <div><dt>Mojang 档案</dt><dd>{{ mojangLabel(detailRow.mojang) }}</dd></div>
            </dl>
          </header>

          <div class="detail-workspace">
            <div class="detail-main-stack">
              <section class="detail-panel model-panel">
                <div class="panel-heading">
                  <h3>交互模型</h3>
                </div>
                <div v-if="detailRow.figureSkin || detailRow.figureCape" class="model-preview-row">
                  <SkinModelViewer
                    :skin="detailRow.figureSkin"
                    :cape="detailRow.figureCape"
                    :slim="detailRow.figureSlim"
                    :label="`${detailRow.account.username} 玩家模型`"
                    :width="260"
                    :height="320"
                  />
                </div>
                <p v-else class="empty panel-empty">该账户没有可展示的皮肤或披风。</p>
              </section>

              <section
                v-if="detailRow.localSkin || detailRow.localCape || detailRow.mojangSkin || detailRow.mojangCape"
                class="detail-panel texture-panel"
              >
                <div class="panel-heading">
                  <h3>纹理原图</h3>
                </div>
                <div class="texture-gallery">
                  <div v-if="detailRow.localSkin" class="texture-item">
                    <span class="texture-source">服务器</span>
                    <img class="texture" :src="detailRow.localSkin" alt="服务器皮肤原图" />
                    <a class="preview-caption link" :href="detailRow.localSkin" target="_blank" rel="noopener">皮肤原图</a>
                  </div>
                  <div v-if="detailRow.localCape" class="texture-item">
                    <span class="texture-source">服务器</span>
                    <img class="texture" :src="detailRow.localCape" alt="服务器披风原图" />
                    <a class="preview-caption link" :href="detailRow.localCape" target="_blank" rel="noopener">披风原图</a>
                  </div>
                  <div v-if="detailRow.mojangSkin" class="texture-item">
                    <span class="texture-source">Mojang</span>
                    <img class="texture" :src="detailRow.mojangSkin" alt="正版皮肤原图" />
                    <a class="preview-caption link" :href="detailRow.mojangSkin" target="_blank" rel="noopener">皮肤原图</a>
                  </div>
                  <div v-if="detailRow.mojangCape" class="texture-item">
                    <span class="texture-source">Mojang</span>
                    <img class="texture" :src="detailRow.mojangCape" alt="正版披风原图" />
                    <a class="preview-caption link" :href="detailRow.mojangCape" target="_blank" rel="noopener">披风原图</a>
                  </div>
                </div>
              </section>
            </div>

            <div class="source-stack">
              <section class="detail-panel source-panel">
                <div class="panel-heading">
                  <h3>离线上传</h3>
                  <span class="badge badge-local">{{ detailRow.hasLocal ? '服务器生效' : '未上传' }}</span>
                </div>
                <template v-if="detailRow.hasLocal">
                  <div class="source-overview">
                    <div class="source-figures">
                      <div class="preview-item">
                        <SkinFigure :skin="detailRow.localSkin" :slim="detailRow.local.model === 'slim'" :pixel-size="4" view="front" />
                        <span class="preview-caption">正面</span>
                      </div>
                      <div class="preview-item">
                        <SkinFigure
                          :skin="detailRow.localSkin"
                          :cape="detailRow.localCape"
                          :slim="detailRow.local.model === 'slim'"
                          :pixel-size="4"
                          view="back"
                        />
                        <span class="preview-caption">背面</span>
                      </div>
                    </div>
                    <dl class="source-facts">
                      <div><dt>模型</dt><dd>{{ modelLabel(detailRow.local.model === 'slim', !!detailRow.local.skin) }}</dd></div>
                      <div><dt>上传时间</dt><dd>{{ formatTime(detailRow.local.updated_at) }}</dd></div>
                      <div><dt>皮肤</dt><dd>{{ detailRow.localSkin ? '有' : '无' }}</dd></div>
                      <div><dt>披风</dt><dd>{{ detailRow.localCape ? '有' : '无' }}</dd></div>
                    </dl>
                  </div>
                </template>
                <p v-else class="empty panel-empty">该账户没有上传过皮肤或披风。</p>
              </section>

              <section class="detail-panel source-panel">
                <div class="panel-heading">
                  <div>
                    <h3>Mojang 正版档案</h3>
                    <p>仅作同名正版账户的外观参考。</p>
                  </div>
                  <span class="badge badge-mojang">{{ detailRow.hasMojang ? '有外观' : '无外观' }}</span>
                </div>
                <p class="source-status">{{ mojangLabel(detailRow.mojang) }}</p>
                <template v-if="detailRow.hasMojang">
                  <div class="source-overview">
                    <div class="source-figures">
                      <div class="preview-item">
                        <SkinFigure :skin="detailRow.mojangSkin" :slim="detailRow.mojang?.model === 'slim'" :pixel-size="4" view="front" />
                        <span class="preview-caption">正面</span>
                      </div>
                      <div class="preview-item">
                        <SkinFigure
                          :skin="detailRow.mojangSkin"
                          :cape="detailRow.mojangCape"
                          :slim="detailRow.mojang?.model === 'slim'"
                          :pixel-size="4"
                          view="back"
                        />
                        <span class="preview-caption">背面</span>
                      </div>
                    </div>
                    <dl class="source-facts">
                      <div><dt>正版名称</dt><dd>{{ detailRow.mojang?.username || '—' }}</dd></div>
                      <div><dt>正版 UUID</dt><dd class="mono" :title="detailRow.mojang?.uuid || ''">{{ detailRow.mojang?.uuid || '—' }}</dd></div>
                      <div><dt>模型</dt><dd>{{ modelLabel(detailRow.mojang?.model === 'slim', !!detailRow.mojang?.skin_hash) }}</dd></div>
                      <div><dt>查询时间</dt><dd>{{ formatTime(detailRow.mojang?.checked_at ?? 0) }}{{ detailRow.mojang?.stale ? '（已过期）' : '' }}</dd></div>
                    </dl>
                  </div>
                </template>
              </section>
            </div>
          </div>

          <section v-if="detailSlots.length" class="detail-panel files-panel">
            <div class="panel-heading">
              <h3>服务器文件明细</h3>
            </div>
            <div class="table-scroll">
              <table class="data-table inner-table">
                <thead><tr><th>槽位</th><th>尺寸</th><th>文件大小</th><th>SHA-256</th><th>上传时间</th></tr></thead>
                <tbody>
                  <tr v-for="slot in detailSlots" :key="slot.slot">
                    <td>{{ slotLabel(slot.slot) }}</td>
                    <td>{{ slot.width }} × {{ slot.height }}</td>
                    <td>{{ formatBytes(slot.bytes) }}</td>
                    <td class="mono hash-cell" :title="slot.sha256">{{ slot.sha256 }}</td>
                    <td>{{ formatTime(slot.updated_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <p class="detail-hint">
            服务器跑离线模式，账户 UUID 由玩家代号推导，同名正版档案只说明 Mojang 存在这个名字，不代表该玩家已通过正版验证。
          </p>
        </div>
      </div>
      <div slot="actions">
        <md-text-button
          v-if="canRefresh && detailRow && !lookupDisabled"
          @click="refreshOne(detailRow.account.username)"
        >
          <md-icon slot="icon">cloud_sync</md-icon>
          重新查询正版
        </md-text-button>
        <md-text-button @click="detailUsername = null">关闭</md-text-button>
      </div>
    </md-dialog>
  </div>
</template>

<style scoped>
.page-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.heading-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.refresh-icon--loading { animation: refresh-spin 800ms linear infinite; }
@keyframes refresh-spin { to { transform: rotate(360deg); } }
.notice { margin: 0 0 16px; padding: 12px 16px; border-radius: 8px; background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.card + .card { margin-top: 20px; }
.toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.search { min-width: 240px; flex: 1 1 240px; }
.filter { min-width: 180px; }
.count { color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.figure-card { display: flex; gap: 14px; padding: 14px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface-container-low); }
.figure-card--none { opacity: 0.72; }
.figure-pair { display: flex; gap: 6px; flex: 0 0 auto; }
.figure-info { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.figure-name { margin: 0; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
.figure-uuid { margin: 0; color: var(--md-sys-color-on-surface-variant); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.figure-meta { margin: 0; font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.figure-actions { margin-top: auto; margin-left: -8px; }
.badges { display: flex; flex-wrap: wrap; gap: 4px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; line-height: 18px; background: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); }
.badge-local { background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); }
.badge-mojang { background: var(--md-sys-color-tertiary-container); color: var(--md-sys-color-on-tertiary-container); }
.badge-hint { border: 1px dashed var(--md-sys-color-outline-variant); background: transparent; }
.section-heading { margin: 0 0 4px; font-size: 17px; }
.section-hint { margin: 0 0 16px; font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.mono { font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.empty { padding: 32px 0; text-align: center; color: var(--md-sys-color-on-surface-variant); }
.cosmetic-detail-dialog {
  margin: 76px auto 12px;
  max-height: calc(100vh - 88px);
  --md-dialog-container-width: min(1040px, calc(100vw - 32px));
  --md-dialog-container-max-width: min(1040px, calc(100vw - 32px));
  --md-dialog-container-max-height: calc(100vh - 88px);
}
.detail { width: min(960px, calc(100vw - 96px)); max-width: 100%; display: flex; flex-direction: column; gap: 16px; }
.detail-summary { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(240px, 0.65fr); align-items: center; gap: 16px; padding: 16px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface-container); }
.detail-avatar { display: flex; width: 80px; height: 80px; align-items: center; justify-content: center; border-radius: 8px; background: var(--md-sys-color-surface-container-high); }
.detail-identity { min-width: 0; }
.detail-identity h2 { margin: 0 0 4px; font-size: 20px; }
.detail-identity p { margin: 0 0 10px; overflow: hidden; color: var(--md-sys-color-on-surface-variant); text-overflow: ellipsis; white-space: nowrap; }
.summary-facts { display: grid; min-width: 0; grid-template-columns: repeat(2, minmax(100px, 1fr)); gap: 10px 16px; margin: 0; }
.summary-facts dt, .source-facts dt { color: var(--md-sys-color-on-surface-variant); font-size: 11px; }
.summary-facts dd, .source-facts dd { margin: 2px 0 0; font-size: 13px; overflow-wrap: anywhere; }
.detail-workspace { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.85fr); align-items: start; gap: 16px; }
.detail-main-stack { display: grid; min-width: 0; align-items: start; gap: 16px; }
.detail-panel { min-width: 0; padding: 16px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface-container); }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.panel-heading > div { min-width: 0; }
.panel-heading > .badge { flex: 0 0 auto; white-space: nowrap; }
.panel-heading h3 { margin: 0; font-size: 15px; font-weight: 600; }
.panel-heading p { margin: 3px 0 0; color: var(--md-sys-color-on-surface-variant); font-size: 12px; line-height: 1.5; }
.model-preview-row { display: flex; align-items: flex-start; justify-content: center; }
.source-stack { display: grid; align-items: start; gap: 16px; }
.source-status { margin: -4px 0 12px; color: var(--md-sys-color-on-surface-variant); font-size: 12px; }
.source-overview { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 16px; align-items: start; }
.source-figures { display: flex; gap: 6px; }
.source-facts { display: grid; gap: 8px; margin: 0; }
.preview-item { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.preview-caption { font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.link { color: var(--md-sys-color-primary); }
.texture-gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 156px), 1fr)); gap: 12px; }
.texture-item { position: relative; display: flex; min-width: 0; flex-direction: column; align-items: center; gap: 7px; padding: 12px; border-radius: 8px; background: var(--md-sys-color-surface-container-low); }
.texture-source { align-self: flex-start; padding: 2px 7px; border-radius: 999px; background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.texture { width: min(128px, 100%); height: auto; aspect-ratio: 1; object-fit: contain; image-rendering: pixelated; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background:
  repeating-conic-gradient(var(--md-sys-color-surface-container-high) 0% 25%, var(--md-sys-color-surface-container) 0% 50%) 0 0 / 16px 16px; }
.table-scroll { max-width: 100%; overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 8px; border-bottom: 1px solid var(--md-sys-color-outline-variant); text-align: left; white-space: nowrap; font-size: 13px; }
.data-table th { color: var(--md-sys-color-on-surface-variant); font-size: 12px; font-weight: 500; }
.data-table tbody tr:last-child td { border-bottom: 0; }
.hash-cell { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.panel-empty { padding: 28px 0; font-size: 13px; }
.detail-hint { margin: 0; padding: 0 4px; color: var(--md-sys-color-on-surface-variant); font-size: 12px; line-height: 1.6; }

@media (max-width: 960px) {
  .detail-workspace { grid-template-columns: minmax(0, 1fr); }
  .source-stack { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 700px) {
  .page-heading { flex-direction: column; align-items: stretch; }
  .heading-actions { width: 100%; }
  .heading-actions md-filled-tonal-button { flex: 1; }
  .search, .filter { width: 100%; min-width: 0; flex-basis: 100%; }
  .grid { grid-template-columns: minmax(0, 1fr); }
  .cosmetic-detail-dialog {
    --md-dialog-container-width: calc(100vw - 24px);
    --md-dialog-container-max-width: calc(100vw - 24px);
  }
  .detail { width: auto; }
  .detail-summary { grid-template-columns: auto minmax(0, 1fr); }
  .summary-facts { grid-column: 1 / -1; }
  .source-stack { grid-template-columns: minmax(0, 1fr); }
  .texture { width: min(96px, 100%); }
}

@media (max-width: 480px) {
  .detail-summary { grid-template-columns: minmax(0, 1fr); text-align: center; }
  .detail-avatar { margin: 0 auto; }
  .detail-identity .badges { justify-content: center; }
  .summary-facts { grid-template-columns: minmax(0, 1fr); text-align: left; }
  .source-overview { grid-template-columns: minmax(0, 1fr); }
  .source-figures { justify-content: center; }
}
</style>
