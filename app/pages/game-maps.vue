<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MAP_CHUNK_LIMIT, MAP_MAX_VIEW_CHUNKS, MAP_TILE_BYTES, mapLayerLabel,
  type GameMapLayer, type GameMapTilePage, type GameMapWorld } from '#shared/game-map'

useHead({ title: '服务器地图' })
const worlds = ref<GameMapWorld[]>([])
const worldId = ref(''), dimension = ref(''), layer = ref<GameMapLayer>('SURFACE'), height = ref(0)
const surface = ref<HTMLCanvasElement | null>(null), container = ref<HTMLElement | null>(null)
const busy = ref(false), refreshing = ref(false), error = ref(''), loaded = ref(0)
const centerX = ref(0), centerZ = ref(0), scale = ref(2), goX = ref('0'), goZ = ref('0'), hover = ref('')
const lighting = ref(false), grid = ref(false)
const world = computed(() => worlds.value.find((value) => value.id === worldId.value))
const dimensions = computed(() => [...new Set(world.value?.layers.map((value) => value.dimension) ?? [])])
const layers = computed(() => [...new Set(world.value?.layers.filter((value) => value.dimension === dimension.value).map((value) => value.layer) ?? [])])
const heights = computed(() => world.value?.layers.filter((value) => value.dimension === dimension.value && value.layer === layer.value).map((value) => value.height).sort((a, b) => a - b) ?? [])
const selected = computed(() => world.value?.layers.find((value) => value.dimension === dimension.value && value.layer === layer.value && value.height === height.value))
const syncText = computed(() => {
  const value = world.value
  if (!value) return ''
  if (!value.syncing) return value.last_success ? '同步完成' : '尚未完成首次同步'
  return Date.now() - value.last_activity > 5 * 60_000 ? '上次上传尚未完成，等待服务器重试' : '服务器正在上传'
})
const DIMENSION_LABELS: Record<string, string> = { 'minecraft:overworld': '主世界', 'minecraft:the_nether': '下界', 'minecraft:the_end': '末地' }
const labelDimension = (id: string) => DIMENSION_LABELS[id] || id
const date = (time: number) => time ? new Date(time).toLocaleString('zh-CN') : '尚无完整同步'
const WORLD_LIMIT = MAP_CHUNK_LIMIT * 16
let width = 900, canvasHeight = 560, controller: AbortController | undefined, generation = 0
let timer: ReturnType<typeof setTimeout> | undefined, frame = 0, observer: ResizeObserver | undefined
let mounted = false, drag: { id: number; x: number; y: number } | null = null
let raster: { canvas: HTMLCanvasElement; x: number; z: number; scale: number; width: number; height: number } | undefined

function cancel() { generation++; controller?.abort(); controller = undefined; busy.value = false; clearTimeout(timer) }
function paintSoon() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint() }) }
function paint() {
  const canvas = surface.value, ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(canvasHeight * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(canvasHeight * ratio)
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, canvasHeight); ctx.imageSmoothingEnabled = false
  if (raster) {
    const zoom = scale.value / raster.scale
    ctx.drawImage(raster.canvas, width / 2 + (raster.x - centerX.value) * scale.value - raster.width * zoom / 2,
      canvasHeight / 2 + (raster.z - centerZ.value) * scale.value - raster.height * zoom / 2, raster.width * zoom, raster.height * zoom)
  }
  if (grid.value && scale.value >= 2) {
    ctx.strokeStyle = 'rgba(127,127,127,.4)'; ctx.lineWidth = 1; ctx.beginPath()
    const step = 16 * scale.value
    const x0 = ((width / 2 - centerX.value * scale.value) % step + step) % step
    const z0 = ((canvasHeight / 2 - centerZ.value * scale.value) % step + step) % step
    for (let x = x0; x <= width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, canvasHeight) }
    for (let y = z0; y <= canvasHeight; y += step) { ctx.moveTo(0, y); ctx.lineTo(width, y) }
    ctx.stroke()
  }
}

function clampCenter() {
  centerX.value = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, centerX.value))
  centerZ.value = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, centerZ.value))
  // 为一次浏览设置有界范围；仍可平移到全部已记录区域。
  scale.value = Math.max(Math.max(width, canvasHeight) / ((MAP_MAX_VIEW_CHUNKS - 2) * 16), Math.min(16, scale.value))
}
function schedule() { if (!mounted) return; clampCenter(); cancel(); paintSoon(); timer = setTimeout(fetchTiles, 180) }
function centerOnData() {
  const bounds = selected.value
  if (!bounds) return
  centerX.value = (bounds.min_x + bounds.max_x + 1) * 8
  centerZ.value = (bounds.min_z + bounds.max_z + 1) * 8
  goX.value = String(Math.floor(centerX.value)); goZ.value = String(Math.floor(centerZ.value)); schedule()
}
function chooseWorld() {
  dimension.value = dimensions.value.includes('minecraft:overworld') ? 'minecraft:overworld' : dimensions.value[0] || ''
  chooseDimension()
}
function chooseDimension() {
  layer.value = layers.value.includes('SURFACE') ? 'SURFACE' : layers.value[0] || 'SURFACE'; chooseLayer()
}
function chooseLayer() {
  height.value = heights.value.includes(height.value) ? height.value : heights.value.reduce((a, b) => Math.abs(b - 63) < Math.abs(a - 63) ? b : a, heights.value[0] ?? 0)
  cancel(); raster = undefined; loaded.value = 0; centerOnData(); paintSoon()
}
function chooseHeight() { cancel(); raster = undefined; loaded.value = 0; schedule() }
function moveTo() {
  const x = Number(goX.value), z = Number(goZ.value)
  if (!goX.value.trim() || !goZ.value.trim() || !Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT) {
    error.value = '请输入世界边界内的有效 X、Z 坐标'; return
  }
  centerX.value = x; centerZ.value = z; error.value = ''; schedule()
}
function zoom(factor: number, x = width / 2, y = canvasHeight / 2) {
  const wx = centerX.value + (x - width / 2) / scale.value, wz = centerZ.value + (y - canvasHeight / 2) / scale.value
  scale.value *= factor; clampCenter()
  centerX.value = wx - (x - width / 2) / scale.value; centerZ.value = wz - (y - canvasHeight / 2) / scale.value; schedule()
}
function wheel(event: WheelEvent) {
  event.preventDefault()
  const rect = surface.value!.getBoundingClientRect()
  zoom(event.deltaY < 0 ? 1.25 : 0.8, event.clientX - rect.left, event.clientY - rect.top)
}
function pointerDown(event: PointerEvent) {
  if (event.button !== 0 || drag) return
  cancel(); surface.value?.focus(); surface.value?.setPointerCapture(event.pointerId)
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY }
}
function pointerMove(event: PointerEvent) {
  if (drag?.id === event.pointerId) {
    centerX.value -= (event.clientX - drag.x) / scale.value; centerZ.value -= (event.clientY - drag.y) / scale.value
    drag.x = event.clientX; drag.y = event.clientY; clampCenter(); paintSoon()
  }
  const rect = surface.value!.getBoundingClientRect()
  hover.value = `X ${Math.floor(centerX.value + (event.clientX - rect.left - width / 2) / scale.value)} · Z ${Math.floor(centerZ.value + (event.clientY - rect.top - canvasHeight / 2) / scale.value)}`
}
function pointerUp(event: PointerEvent) { if (drag?.id === event.pointerId) { drag = null; schedule() } }
function keydown(event: KeyboardEvent) {
  if (event.key === '+' || event.key === '=') zoom(1.25)
  else if (event.key === '-') zoom(0.8)
  else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    centerX.value += (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0) * 80 / scale.value
    centerZ.value += (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0) * 80 / scale.value; schedule()
  } else return
  event.preventDefault()
}

/** 每次请求只保留当前视口的一张位图；快速切换维度时丢弃旧响应。 */
async function fetchTiles() {
  if (!selected.value || !mounted) return
  const token = ++generation, abort = new AbortController(); controller = abort
  const captured = { canvas: document.createElement('canvas'), x: centerX.value, z: centerZ.value, scale: scale.value, width, height: canvasHeight }
  captured.canvas.width = Math.ceil(width); captured.canvas.height = Math.ceil(canvasHeight)
  const ctx = captured.canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const tileCanvas = document.createElement('canvas'); tileCanvas.width = 16; tileCanvas.height = 16
  const tileContext = tileCanvas.getContext('2d')!
  const chunk = (v: number) => Math.max(-MAP_CHUNK_LIMIT, Math.min(MAP_CHUNK_LIMIT, Math.floor(v / 16)))
  const query = { world: worldId.value, dimension: dimension.value, layer: layer.value, height: height.value,
    min_x: chunk(captured.x - width / (2 * captured.scale)), max_x: chunk(captured.x + width / (2 * captured.scale)),
    min_z: chunk(captured.z - canvasHeight / (2 * captured.scale)), max_z: chunk(captured.z + canvasHeight / (2 * captured.scale)) }
  const useLight = lighting.value, nether = dimension.value === 'minecraft:the_nether'
  busy.value = true; loaded.value = 0; error.value = ''; raster = captured; paintSoon()
  try {
    let after: number | null = -1
    do {
      const page: GameMapTilePage = await $fetch('/api/admin/game-maps/tiles', { query: { ...query, after }, signal: abort.signal })
      if (token !== generation) return
      for (const tile of page.tiles) {
        const binary = atob(tile.data)
        if (binary.length !== MAP_TILE_BYTES) throw new Error('地图数据长度无效')
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0)), data = new DataView(bytes.buffer)
        const image = tileContext.createImageData(16, 16)
        for (let i = 0; i < 256; i++) {
          const elevation = data.getInt16(1024 + i * 2)
          const west = i % 16 ? data.getInt16(1024 + (i - 1) * 2) : elevation
          const north = i >= 16 ? data.getInt16(1024 + (i - 16) * 2) : elevation
          let shade = 0.93 + Math.max(-6, Math.min(6, (west === -32768 ? elevation : west) + (north === -32768 ? elevation : north) - 2 * elevation)) * 0.022
          if (useLight) {
            const light = bytes[1536 + i]!, brightness = Math.max(light & 15, light >>> 4), ambient = nether ? 0.48 : 0.25
            shade *= Math.min(1, ambient + brightness / 15 * (1 - ambient) + 0.15)
          }
          for (let channel = 0; channel < 3; channel++) image.data[i * 4 + channel] = Math.min(255, Math.floor(bytes[i * 4 + channel]! * shade))
          image.data[i * 4 + 3] = bytes[i * 4 + 3]!
        }
        tileContext.putImageData(image, 0, 0)
        ctx.drawImage(tileCanvas, width / 2 + (tile.x * 16 - captured.x) * captured.scale,
          canvasHeight / 2 + (tile.z * 16 - captured.z) * captured.scale, 16 * captured.scale, 16 * captured.scale)
      }
      loaded.value += page.tiles.length; paintSoon(); after = page.next
    } while (after !== null)
  } catch (failure: any) {
    if (!abort.signal.aborted && token === generation) error.value = failure?.data?.statusMessage || failure?.message || '地图读取失败，请稍后重试'
  } finally { if (token === generation) busy.value = false }
}

async function refreshWorlds() {
  refreshing.value = true; error.value = ''
  try {
    const result = await $fetch<{ worlds: GameMapWorld[] }>('/api/admin/game-maps')
    if (!mounted) return
    worlds.value = result.worlds
    if (!world.value) { worldId.value = worlds.value[0]?.id || ''; chooseWorld() }
    else if (!selected.value) chooseWorld()
    else schedule()
  } catch (failure: any) { error.value = failure?.data?.statusMessage || '无法获取服务器地图' }
  finally { refreshing.value = false }
}
watch(lighting, schedule); watch(grid, paintSoon)
onMounted(async () => {
  mounted = true; await nextTick()
  observer = new ResizeObserver(([entry]) => {
    if (!entry) return
    width = Math.max(1, entry.contentRect.width); canvasHeight = Math.max(1, entry.contentRect.height); schedule()
  })
  if (container.value) observer.observe(container.value)
  await refreshWorlds()
})
onBeforeUnmount(() => { mounted = false; cancel(); observer?.disconnect(); if (frame) cancelAnimationFrame(frame); raster = undefined })
</script>

<template>
  <section class="map-page">
    <div class="map-heading">
      <div><h1>服务器地图</h1><p>浏览服务器已记录的地表和地下切片，每两天自动同步。</p></div>
      <md-outlined-button :disabled="refreshing" @click="refreshWorlds"><md-icon slot="icon">refresh</md-icon>刷新数据</md-outlined-button>
    </div>
    <div v-if="error" class="map-error" role="alert">{{ error }}</div>
    <div v-if="!refreshing && !worlds.length" class="map-empty">
      <md-icon>map</md-icon><h2>等待服务器上传地图</h2>
      <p>首次同步完成后，可以在这里选择存档、维度和地下高度。请确认模组的 Api 网桥与地图上传已开启。</p>
    </div>
    <div v-show="worlds.length" class="map-card">
      <div class="map-toolbar">
        <label>存档<select v-model="worldId" @change="chooseWorld"><option v-for="item in worlds" :key="item.id" :value="item.id">{{ item.name }} · {{ item.id.slice(0, 8) }}</option></select></label>
        <label>维度<select v-model="dimension" @change="chooseDimension"><option v-for="id in dimensions" :key="id" :value="id">{{ labelDimension(id) }}</option></select></label>
        <label>图层<select v-model="layer" @change="chooseLayer"><option v-for="value in layers" :key="value" :value="value">{{ mapLayerLabel(value) }}</option></select></label>
        <label v-if="layer === 'FIXED' || layer === 'CAVE'">高度 Y<select v-model.number="height" @change="chooseHeight"><option v-for="y in heights" :key="y" :value="y">Y {{ y }}</option></select></label>
        <label class="map-check"><input v-model="lighting" type="checkbox">光照</label>
        <label class="map-check"><input v-model="grid" type="checkbox">区块网格</label>
      </div>
      <div class="map-navigation">
        <md-outlined-button title="放大地图" @click="zoom(1.5)"><md-icon>add</md-icon></md-outlined-button>
        <md-outlined-button title="缩小地图" @click="zoom(1 / 1.5)"><md-icon>remove</md-icon></md-outlined-button>
        <md-outlined-button @click="centerOnData">已记录区域中心</md-outlined-button>
        <form class="map-location" @submit.prevent="moveTo"><label>X<input v-model="goX" inputmode="numeric" aria-label="目标 X 坐标"></label><label>Z<input v-model="goZ" inputmode="numeric" aria-label="目标 Z 坐标"></label><md-outlined-button type="submit">定位</md-outlined-button></form>
      </div>
      <div ref="container" class="map-viewport">
        <canvas ref="surface" tabindex="0" aria-label="服务器地图，拖动平移、滚轮缩放，也可使用方向键和加减键"
          @wheel="wheel" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp"
          @pointercancel="pointerUp" @lostpointercapture="pointerUp" @keydown="keydown" />
        <span class="map-north" aria-hidden="true">↑ 北</span>
        <span v-if="!selected" class="map-overlay">当前存档尚未上传地形</span>
        <span v-else-if="!busy && !loaded" class="map-overlay">此处暂无已记录地形，可拖动地图或重新定位</span>
        <span class="map-loading" role="status">{{ busy ? `正在载入 · ${loaded} 个区块` : `${loaded} 个区块` }}</span>
      </div>
      <div class="map-footer"><span>{{ hover || `中心 X ${Math.floor(centerX)} · Z ${Math.floor(centerZ)}` }} · {{ scale.toFixed(2) }}×</span><span>拖动平移 · 滚轮缩放 · 棋盘格表示暂无地形</span></div>
    </div>
    <div v-if="world" class="map-sync" aria-live="polite">
      <span>{{ syncText }}</span><span>最近完整同步：{{ date(world.last_success) }}</span><span>已保存 {{ world.tile_count.toLocaleString() }} 个图层区块</span>
    </div>
    <p v-if="world" class="map-note">地下高度切片每 8 格自动记录，也可查看游戏内已保存的洞穴图层。地形按采样进度逐步补齐；此页显示上传快照，不是实时画面。</p>
  </section>
</template>

<style scoped>
.map-page { display: flex; flex-direction: column; gap: 18px; }
.map-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
h1 { margin: 0 0 6px; font-size: 28px; font-weight: 600; }
.map-heading p, .map-note { margin: 0; color: var(--md-sys-color-on-surface-variant); line-height: 1.7; }
.map-card { border: 1px solid var(--md-sys-color-outline-variant); border-radius: 24px; overflow: hidden; background: var(--md-sys-color-surface-container-low); }
.map-toolbar, .map-navigation { display: flex; align-items: end; gap: 12px; padding: 16px; flex-wrap: wrap; }
.map-navigation { align-items: center; padding-top: 0; }
.map-toolbar label, .map-location label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--md-sys-color-on-surface-variant); }
select, .map-location input { font: inherit; color: var(--md-sys-color-on-surface); background: var(--md-sys-color-surface); border: 1px solid var(--md-sys-color-outline); border-radius: 10px; padding: 10px 12px; min-height: 42px; max-width: 290px; }
select:focus-visible, input:focus-visible, canvas:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: -2px; }
.map-toolbar .map-check { flex-direction: row; align-items: center; min-height: 42px; }
input[type=checkbox] { accent-color: var(--md-sys-color-primary); width: 18px; height: 18px; }
.map-location { margin-left: auto; display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
.map-location input { width: 110px; box-sizing: border-box; }
.map-viewport { height: clamp(350px, 62vh, 820px); width: 100%; position: relative; overflow: hidden; background-color: var(--md-sys-color-surface); background-image: conic-gradient(var(--md-sys-color-surface-container-high) 25%, transparent 0 50%, var(--md-sys-color-surface-container-high) 0 75%, transparent 0); background-size: 24px 24px; }
canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
canvas:active { cursor: grabbing; }
.map-north, .map-loading, .map-overlay { position: absolute; pointer-events: none; background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface); border-radius: 12px; padding: 9px 13px; font-size: 13px; }
.map-north { top: 12px; left: 12px; }.map-loading { right: 12px; bottom: 12px; }
.map-overlay { left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; max-width: 80%; }
.map-footer, .map-sync { display: flex; gap: 10px 24px; justify-content: space-between; flex-wrap: wrap; font-size: 13px; color: var(--md-sys-color-on-surface-variant); }
.map-footer { padding: 12px 16px; }.map-sync { justify-content: start; }
.map-error { border-radius: 14px; padding: 14px 18px; background: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); }
.map-empty { text-align: center; padding: 64px 24px; border-radius: 24px; background: var(--md-sys-color-surface-container-low); }
.map-empty md-icon { --md-icon-size: 48px; color: var(--md-sys-color-primary); }.map-empty p { max-width: 600px; margin: auto; line-height: 1.8; color: var(--md-sys-color-on-surface-variant); }
@media (max-width: 640px) { .map-toolbar label { flex: 1; min-width: 110px; } select { width: 100%; max-width: none; }.map-location { margin-left: 0; }.map-heading { align-items: start; }.map-card { border-radius: 18px; } }
</style>
