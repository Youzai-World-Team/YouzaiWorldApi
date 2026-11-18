<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GameMapOverview, GameMapOverviewCell } from '#shared/game-map'
import type { MapPoint, MapRectangle } from '#shared/game-map-view'

const props = defineProps<{ overview: GameMapOverview | null; viewport: MapRectangle; busy: boolean; error?: string }>()
const emit = defineEmits<{ choose: [point: MapPoint]; retry: [] }>()
const active = ref(0)
const bounds = computed(() => {
  const value = props.overview
  if (!value?.cells.length) return { x: 0, z: 0, width: 1, height: 1 }
  const size = value.cell_size
  const x = Math.floor(value.min_x / size) * size, z = Math.floor(value.min_z / size) * size
  return { x, z, width: (Math.floor(value.max_x / size) + 1) * size - x, height: (Math.floor(value.max_z / size) + 1) * size - z }
})
const quickRegions = computed(() => [...(props.overview?.cells || [])].sort((a, b) => b.count - a.count).slice(0, 4))
const visible = computed(() => {
  const box = bounds.value, viewport = props.viewport
  const x = Math.max(box.x, viewport.minX), z = Math.max(box.z, viewport.minZ)
  return { x, z, width: Math.max(0, Math.min(box.x + box.width, viewport.maxX + 1) - x), height: Math.max(0, Math.min(box.z + box.height, viewport.maxZ + 1) - z) }
})

function choose(cell: GameMapOverviewCell) { emit('choose', { x: cell.focus_x * 16 + 8, z: cell.focus_z * 16 + 8 }) }
function keyboard(event: KeyboardEvent) {
  const cells = props.overview?.cells || []
  if (!cells.length) return
  const index = Math.min(active.value, cells.length - 1), current = cells[index]!
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(current); return }
  const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  const direction = directions[event.key]
  if (!direction) return
  event.preventDefault()
  const candidates = cells.map((cell, i) => ({ cell, i })).filter(({ cell }) => (cell.x - current.x) * direction[0]! + (cell.z - current.z) * direction[1]! > 0)
  const next = candidates.sort((a, b) => Math.hypot(a.cell.x - current.x, a.cell.z - current.z) - Math.hypot(b.cell.x - current.x, b.cell.z - current.z))[0]
  if (next) active.value = next.i
}
</script>

<template>
  <aside class="map-overview" aria-label="已记录区域总览">
    <div class="overview-heading"><strong>已记录区域总览</strong><span>↑ 北</span></div>
    <p>点击彩色区域进入地形。边框表示当前视口。</p>
    <p v-if="error" role="alert">{{ error }} <button type="button" @click="emit('retry')">重试</button></p>
    <span v-if="busy && !overview" role="status">正在读取区域分布…</span>
    <svg v-if="overview?.cells.length" :viewBox="`${bounds.x} ${bounds.z} ${bounds.width} ${bounds.height}`" tabindex="0" role="group"
      aria-label="使用方向键选择已记录区域，按回车定位" @keydown="keyboard">
      <title>已记录区域分布，点击定位</title>
      <rect v-for="(cell, i) in overview.cells" :key="`${cell.x},${cell.z}`" class="overview-cell"
        :class="{ 'overview-cell-active': i === active }" :x="cell.x * overview.cell_size" :y="cell.z * overview.cell_size"
        :width="overview.cell_size" :height="overview.cell_size" :opacity="0.4 + Math.min(0.6, cell.count / (overview.cell_size ** 2) * 0.6)"
        @click="active = i; choose(cell)"><title>{{ cell.count }} 个区块 · X {{ cell.focus_x * 16 + 8 }} Z {{ cell.focus_z * 16 + 8 }}</title></rect>
      <rect class="overview-viewport" :x="visible.x" :y="visible.z" :width="visible.width" :height="visible.height" vector-effect="non-scaling-stroke" />
    </svg>
    <p v-else-if="!busy && !error">此图层尚无已记录区域。</p>
    <div class="overview-regions"><button v-for="(cell, i) in quickRegions" :key="`${cell.x},${cell.z}`" type="button" @click="choose(cell)">区域 {{ i + 1 }} · {{ cell.count.toLocaleString() }} 区块</button></div>
  </aside>
</template>

<style scoped>
.map-overview { padding: 16px; border-top: 1px solid var(--md-sys-color-outline-variant); background: var(--md-sys-color-surface-container-low); }
.overview-heading { display: flex; justify-content: space-between; gap: 12px; }
p { margin: 8px 0 12px; font-size: 13px; line-height: 1.6; color: var(--md-sys-color-on-surface-variant); }
svg { display: block; width: 100%; height: 220px; border-radius: 12px; background: var(--md-sys-color-surface); outline-offset: 3px; }
.overview-cell { fill: var(--md-sys-color-primary); cursor: pointer; }.overview-cell:hover, .overview-cell-active { fill: var(--md-sys-color-tertiary); }
.overview-viewport { fill: none; stroke: var(--md-sys-color-on-surface); stroke-width: 2; pointer-events: none; }
.overview-regions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
button { border: 1px solid var(--md-sys-color-outline-variant); border-radius: 16px; background: var(--md-sys-color-surface); color: var(--md-sys-color-on-surface); font: inherit; padding: 8px 12px; cursor: pointer; }
</style>
