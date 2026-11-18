<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MAP_UPLOAD_COMMAND, type GameMapIndex, type GameMapReset, type GameMapUploadRequest } from '#shared/game-map'

const access = useAdminAccess()
const { showToast } = useToast()
const canManage = computed(() => access.levelForKey('settings') === 'edit' && access.featureLevelForKey('settings-game-maps') === 'edit')
const data = ref<GameMapIndex | null>(null), loading = ref(false), error = ref('')
const selected = ref('all'), pending = ref(false), uploadPending = ref(false), confirmOpen = ref(false)
const lastRequest = ref<GameMapUploadRequest | null>(null)
const requestAt = ref(0)
const target = ref({ world: 'all', name: '全部存档', count: 0 })
const expected = ref<{ world_id: string; data_id: string }[]>([])
const selectedWorld = computed(() => data.value?.worlds.find(world => world.id === selected.value))
const tileCount = computed(() => selected.value === 'all' ? data.value?.worlds.reduce((sum, world) => sum + world.tile_count, 0) || 0 : selectedWorld.value?.tile_count || 0)
const result = computed(() => {
  const at = Math.max(requestAt.value, data.value?.reset?.at || 0)
  if (at && data.value?.worlds.some(world => world.last_success >= at && !world.syncing)) return { status: 'requested', message: '已收到服务器新的完整地图快照。' }
  const syncing = at ? data.value?.worlds.find(world => world.syncing && world.last_activity >= at) : null
  if (syncing) return { status: 'requested', message: `服务器正在重新上传，已接收 ${Math.max(0, syncing.upload_batch + 1)} 批数据。` }
  return (data.value?.reset?.at || 0) > requestAt.value ? data.value?.reset : lastRequest.value || data.value?.reset
})
let mounted = false, timer: ReturnType<typeof setInterval> | undefined
let controller: AbortController | undefined

async function load() {
  if (!mounted || !canManage.value || loading.value) return
  loading.value = true
  const abort = new AbortController(); controller = abort
  try {
    const index = await $fetch<GameMapIndex>('/api/admin/game-map-data', { signal: abort.signal })
    if (!mounted) return
    data.value = index; error.value = ''
    if (selected.value !== 'all' && !selectedWorld.value) selected.value = 'all'
  } catch (failure: any) {
    if (!abort.signal.aborted) error.value = failure?.data?.statusMessage || '地图数据统计读取失败'
  } finally { if (!abort.signal.aborted) loading.value = false }
}

function openConfirmation() {
  if (!canManage.value || pending.value || loading.value) return
  target.value = { world: selected.value, name: selected.value === 'all' ? '全部存档' : selectedWorld.value?.name || selected.value, count: tileCount.value }
  expected.value = (data.value?.worlds || []).filter(world => selected.value === 'all' || world.id === selected.value)
    .map(world => ({ world_id: world.id, data_id: world.data_id }))
  confirmOpen.value = true
}

async function reset() {
  if (!canManage.value || pending.value) return
  pending.value = true; error.value = ''
  try {
    const reset = await $fetch<GameMapReset>('/api/admin/game-map-data/reset', { method: 'POST',
      body: { world: target.value.world, confirmed: true, expected: expected.value } })
    confirmOpen.value = false; lastRequest.value = reset; requestAt.value = reset.at
    showToast(`已清空 ${reset.removed_tiles.toLocaleString()} 个图层区块，等待重新上传`)
    await load()
  } catch (failure: any) {
    const message = failure?.data?.statusMessage || '地图数据清空失败'
    confirmOpen.value = false
    if ([404, 409].includes(failure?.statusCode || failure?.response?.status)) await load()
    error.value = message
  }
  finally { pending.value = false }
}

async function requestUpload() {
  if (!canManage.value || uploadPending.value || pending.value) return
  uploadPending.value = true
  requestAt.value = Date.now()
  try {
    lastRequest.value = await $fetch<GameMapUploadRequest>('/api/admin/game-map-data/upload', { method: 'POST' })
    showToast(lastRequest.value.message, lastRequest.value.status === 'failed' ? 'error' : 'info')
    await load()
  } catch (failure: any) { error.value = failure?.data?.statusMessage || '地图上传请求失败' }
  finally { uploadPending.value = false }
}

async function copyCommand() {
  try { await navigator.clipboard.writeText(MAP_UPLOAD_COMMAND); showToast('已复制服务器控制台上传命令') }
  catch { showToast(`请在服务器控制台执行 ${MAP_UPLOAD_COMMAND}`, 'info') }
}

watch(canManage, allowed => { if (allowed) void load() })
onMounted(() => { mounted = true; void load(); timer = setInterval(() => { if (!document.hidden && !pending.value) void load() }, 15_000) })
onBeforeUnmount(() => { mounted = false; clearInterval(timer); controller?.abort() })
</script>

<template>
  <section v-if="canManage" id="game-map-data" class="card settings-card map-data-settings">
    <div class="map-data-heading"><h2 class="card-title">服务器地图数据</h2><NuxtLink to="/game-maps">查看地图</NuxtLink></div>
    <p class="card-note">重置 Minecraft 存档后，可清空这里保存的旧地图，再从当前游戏服务器全量上传。此功能默认仅初始管理员可用，可在权限管理中授权。</p>
    <p v-if="error" class="map-data-error" role="alert">{{ error }}</p>
    <div class="map-data-controls">
      <label>清空范围<select v-model="selected" :disabled="loading || pending || uploadPending">
        <option value="all">全部存档（{{ data?.worlds.length || 0 }} 个）</option>
        <option v-for="world in data?.worlds || []" :key="world.id" :value="world.id">{{ world.name }} · {{ world.id.slice(0, 8) }}</option>
      </select></label>
      <span>{{ loading && !data ? '正在读取…' : `${tileCount.toLocaleString()} 个图层区块` }}</span>
    </div>
    <p v-if="!data?.diagnostics.panel_bound" class="card-note">尚未绑定管理实例：清空后，下次 Core 同步会全量补传；也可在服务器控制台执行 <code>{{ MAP_UPLOAD_COMMAND }}</code> 立即上传。</p>
    <p v-else class="card-note">清空后向已绑定的管理实例发送上传命令。上传的是该实例当前运行的存档；首次扫描和上传可能需要一些时间。</p>
    <p v-if="result" class="map-data-result" :class="{ 'map-data-error': result.status === 'failed' }" role="status">{{ result.message }}</p>
    <div class="map-data-actions">
      <md-outlined-button class="map-data-reset" :disabled="loading || pending || uploadPending || !data?.worlds.length" @click="openConfirmation"><md-icon slot="icon">delete_sweep</md-icon>清空地图并重新上传</md-outlined-button>
      <md-outlined-button :disabled="pending || uploadPending" @click="requestUpload"><md-icon slot="icon">sync</md-icon>{{ uploadPending ? '正在请求…' : '仅请求重新上传' }}</md-outlined-button>
      <md-text-button @click="copyCommand">复制上传命令</md-text-button>
    </div>
    <ConfirmDialog :open="confirmOpen" title="清空地图并重新上传" icon="delete_sweep" destructive
      :message="`将永久清空「${target.name}」的地图快照和同步进度，约 ${target.count.toLocaleString()} 个图层区块。请确认 Minecraft 存档已经重置，当前管理实例运行的是新存档。`"
      confirm-label="清空并请求上传" :pending="pending" pending-label="正在清空…" @confirm="reset" @cancel="confirmOpen = false" />
  </section>
</template>

<style scoped>
.map-data-settings { display: flex; flex-direction: column; gap: 16px; }
.map-data-heading, .map-data-controls, .map-data-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.map-data-heading { justify-content: space-between; }
.card-title, .card-note { margin: 0; }.card-note { color: var(--md-sys-color-on-surface-variant); line-height: 1.7; }
.map-data-controls label { display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
select { font: inherit; padding: 12px; border-radius: 12px; border: 1px solid var(--md-sys-color-outline); color: var(--md-sys-color-on-surface); background: var(--md-sys-color-surface); max-width: 100%; }
.map-data-reset { --md-outlined-button-label-text-color: var(--md-sys-color-error); --md-outlined-button-icon-color: var(--md-sys-color-error); }
.map-data-result, .map-data-error { margin: 0; border-radius: 12px; padding: 12px 16px; line-height: 1.7; background: var(--md-sys-color-surface-container-high); }
.map-data-error { color: var(--md-sys-color-on-error-container); background: var(--md-sys-color-error-container); }
</style>
