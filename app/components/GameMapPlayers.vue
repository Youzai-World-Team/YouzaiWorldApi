<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { mapPlayerSourceLabel, type GameMapPlayer } from '#shared/game-map'

const props = defineProps<{ players: GameMapPlayer[]; busy: boolean; error: string; dimension: string;
  selected?: string; now: number; labelDimension: (id: string) => string }>()
const emit = defineEmits<{ choose: [player: GameMapPlayer]; refresh: [] }>()
const search = ref(''), currentOnly = ref(false), limit = ref(100)
const filtered = computed(() => props.players.filter(player => (!currentOnly.value || player.dimension === props.dimension)
  && player.name.toLowerCase().includes(search.value.trim().toLowerCase())))
watch([search, currentOnly, () => props.dimension], () => { limit.value = 100 })
const exactTime = (time: number) => new Date(time).toLocaleString('zh-CN')
function age(time: number) {
  const minutes = Math.max(0, Math.floor((props.now - time) / 60_000))
  if (!minutes) return '不到一分钟前'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`
  return `${Math.floor(minutes / 1440)} 天前`
}
</script>

<template>
  <details open class="map-players">
    <summary>玩家最近位置 <span>{{ players.length }} 人</span></summary>
    <p class="map-players-note">显示最近一次记录，不代表实时位置或在线状态；认证后、下线前及地图上传时更新。点击玩家可切换维度并定位。</p>
    <div class="map-players-controls">
      <label class="map-player-search">搜索玩家<input v-model="search" type="search" placeholder="输入玩家名" autocomplete="off"></label>
      <label><input v-model="currentOnly" type="checkbox">仅当前维度</label>
      <button type="button" :disabled="busy" @click="emit('refresh')">{{ busy ? '正在读取…' : '重读位置' }}</button>
    </div>
    <p v-if="error" class="map-players-error" role="alert">{{ error }}</p>
    <p v-if="!players.length" class="map-players-note" role="status">{{ busy ? '正在读取玩家位置快照…' : error ? '暂时无法读取玩家位置。' : '尚无玩家位置记录。更新 Core 后，玩家认证或下次地图上传时会记录。' }}</p>
    <p v-else-if="!filtered.length" class="map-players-note">没有符合条件的玩家位置。</p>
    <div v-else class="map-player-list">
      <button v-for="player in filtered.slice(0, limit)" :key="player.uuid" type="button" class="map-player"
        :aria-pressed="selected === player.uuid" @click="emit('choose', player)">
        <strong>{{ player.name }}</strong>
        <span>{{ labelDimension(player.dimension) }} · X {{ Math.floor(player.x) }} · Y {{ Math.floor(player.y) }} · Z {{ Math.floor(player.z) }}</span>
        <small>记录于 {{ exactTime(player.recorded_at) }}</small>
        <small>{{ age(player.recorded_at) }} · {{ mapPlayerSourceLabel(player.source) }}</small>
      </button>
    </div>
    <button v-if="filtered.length > limit" type="button" class="map-player-more" @click="limit += 100">显示更多（还有 {{ filtered.length - limit }} 人）</button>
  </details>
</template>

<style scoped>
.map-players { padding: 16px; border-top: 1px solid var(--md-sys-color-outline-variant); }
summary { display: flex; gap: 12px; align-items: center; cursor: pointer; font-weight: 600; }
summary span, .map-players-note, .map-player small { color: var(--md-sys-color-on-surface-variant); font-weight: 400; }
.map-players-note { margin: 12px 0; font-size: 13px; line-height: 1.7; }
.map-players-controls { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.map-players-controls label { display: flex; gap: 8px; align-items: center; font-size: 13px; min-height: 42px; }
.map-players-controls .map-player-search { align-items: stretch; flex-direction: column; flex: 1; min-width: 180px; }
button, input[type=search] { font: inherit; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 12px; padding: 10px 12px; min-height: 42px; background: var(--md-sys-color-surface); color: var(--md-sys-color-on-surface); }
input[type=checkbox] { accent-color: var(--md-sys-color-primary); width: 18px; height: 18px; }
button { cursor: pointer; }button:disabled { opacity: .5; cursor: default; }
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: 2px; }
.map-player-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: 8px; max-height: 330px; overflow-y: auto; padding: 2px; }
.map-player { text-align: left; display: flex; flex-direction: column; gap: 5px; overflow-wrap: anywhere; }
.map-player strong { color: var(--md-sys-color-tertiary); }.map-player span, .map-player small { font-size: 12px; line-height: 1.6; }
.map-player[aria-pressed=true] { background: var(--md-sys-color-secondary-container); border-color: var(--md-sys-color-primary); }.map-player:hover:not(:disabled) { border-color: var(--md-sys-color-primary); }
.map-player-more { margin-top: 12px; }.map-players-error { padding: 12px; border-radius: 12px; color: var(--md-sys-color-on-error-container); background: var(--md-sys-color-error-container); line-height: 1.7; }
</style>
