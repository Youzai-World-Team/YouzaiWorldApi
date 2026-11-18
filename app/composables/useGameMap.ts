import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MAP_CHUNK_LIMIT, MAP_TILE_BYTES, MAP_UPLOAD_COMMAND, type GameMapIndex, type GameMapLayer,
  type GameMapOverview, type GameMapTilePage, type GameMapUploadRequest } from '#shared/game-map'
import { MAP_BLOCK_LIMIT, MAP_DETAIL_CHUNKS, mapFitScale, mapPinchView, parseMapLocation,
  type MapPoint, type MapRectangle } from '#shared/game-map-view'
import { GameMapTileCache, mapTileCanvas } from '../utils/game-map-cache'
import { MAX_MAP_LANDMARKS, emptyMapPreferences, pruneMapPreferences, readMapPreferences,
  rememberMapDestination, rememberMapView, type MapLandmark, type SavedMapView } from '../utils/game-map-preferences'

const FETCH_DELAY_MS = 180
const POLL_INTERVAL_MS = 15_000
const UPLOAD_STALL_MS = 5 * 60_000
const STALE_SNAPSHOT_MS = 48 * 60 * 60_000
const MAX_OVERVIEW_CACHE = 12
const DIMENSION_LABELS: Record<string, string> = { 'minecraft:overworld': '主世界', 'minecraft:the_nether': '下界', 'minecraft:the_end': '末地' }

export function useGameMap() {
  const access = useAdminAccess(), { showToast } = useToast()
  const index = ref<GameMapIndex | null>(null)
  const worlds = computed(() => index.value?.worlds || [])
  const worldId = ref(''), dimension = ref(''), layer = ref<GameMapLayer>('SURFACE'), height = ref(0)
  const centerX = ref(0), centerZ = ref(0), scale = ref(2), location = ref('')
  const card = ref<HTMLElement | null>(null), surface = ref<HTMLCanvasElement | null>(null), container = ref<HTMLElement | null>(null)
  const width = ref(900), canvasHeight = ref(560)
  const busy = ref(false), refreshing = ref(false), error = ref(''), statusError = ref(''), loaded = ref(0)
  const lighting = ref(false), grid = ref(false), overviewOpen = ref(false), fullScreen = ref(false)
  const overview = ref<GameMapOverview | null>(null), overviewBusy = ref(false), overviewError = ref('')
  const now = ref(Date.now()), hover = ref<MapPoint | null>(null), pointed = ref<MapPoint | null>(null)
  const preferences = ref(emptyMapPreferences()), landmarkOpen = ref(false), landmarkName = ref('')
  const uploadPending = ref(false), uploadRequest = ref<GameMapUploadRequest | null>(null)
  const tileVersion = ref(0)
  let uploadRequestedAt = 0
  const world = computed(() => worlds.value.find(value => value.id === worldId.value))
  const dimensions = computed(() => world.value?.dimensions.map(value => value.id) || [])
  const layers = computed(() => [...new Set(world.value?.layers.filter(value => value.dimension === dimension.value).map(value => value.layer) || [])])
  const heights = computed(() => world.value?.layers.filter(value => value.dimension === dimension.value && value.layer === layer.value).map(value => value.height).sort((a, b) => a - b) || [])
  const selected = computed(() => world.value?.layers.find(value => value.dimension === dimension.value && value.layer === layer.value && value.height === height.value))
  const namespace = computed(() => world.value ? `${world.value.id}|${world.value.data_id}|${dimension.value}|${layer.value}|${height.value}` : '')
  const canRequestUpload = computed(() => access.levelForKey('settings') === 'edit' && access.featureLevelForKey('settings-game-maps') === 'edit')
  const canViewSettings = computed(() => access.levelForKey('settings') !== 'hidden')
  const landmarks = computed(() => preferences.value.landmarks.filter(value => value.world === worldId.value && value.dimension === dimension.value))
  const recent = computed(() => preferences.value.recent)
  const coordinate = computed(() => pointed.value || { x: centerX.value, z: centerZ.value })
  const coordinateText = computed(() => `X ${Math.floor(coordinate.value.x)} · Z ${Math.floor(coordinate.value.z)}`)
  const viewport = computed<MapRectangle>(() => {
    const chunk = (value: number) => Math.max(-MAP_CHUNK_LIMIT, Math.min(MAP_CHUNK_LIMIT, Math.floor(value / 16)))
    return { minX: chunk(centerX.value - width.value / (2 * scale.value)), maxX: chunk(centerX.value + width.value / (2 * scale.value)),
      minZ: chunk(centerZ.value - canvasHeight.value / (2 * scale.value)), maxZ: chunk(centerZ.value + canvasHeight.value / (2 * scale.value)) }
  })
  const heightIndex = computed({ get: () => Math.max(0, heights.value.indexOf(height.value)), set: (value: number) => chooseHeight(heights.value[value] ?? height.value) })
  const snapshotAge = computed(() => {
    const time = world.value?.last_success
    if (!time) return '尚无完整快照'
    const minutes = Math.max(0, Math.floor((now.value - time) / 60_000))
    if (!minutes) return '不到一分钟前'
    if (minutes < 60) return `${minutes} 分钟前`
    if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`
    return `${Math.floor(minutes / 1440)} 天前`
  })
  const stale = computed(() => Boolean(world.value?.last_success && now.value - world.value.last_success > STALE_SNAPSHOT_MS))
  const stalled = computed(() => Boolean(world.value?.syncing && now.value - world.value.last_activity > UPLOAD_STALL_MS))
  const syncText = computed(() => {
    const value = world.value
    if (!value) return index.value?.reset ? '地图已清空，等待全量上传' : '等待首次上传'
    if (value.syncing) return stalled.value ? '上传已停顿，等待 Core 重试' : `服务器正在上传 · 已接收 ${Math.max(0, value.upload_batch + 1)} 批数据`
    return value.last_success ? '已保存地图快照' : '尚未完成首次同步'
  })
  const pointerElevation = computed(() => {
    // 瓦片缓存本身不参与 Vue 响应式；收到新像素后重新读取选点高度。
    tileVersion.value
    const point = coordinate.value, x = Math.floor(point.x), z = Math.floor(point.z)
    const tile = cache.get(namespace.value, Math.floor(x / 16), Math.floor(z / 16))
    if (!tile) return null
    const offset = ((z % 16 + 16) % 16) * 16 + (x % 16 + 16) % 16
    const value = new DataView(tile.bytes.buffer, tile.bytes.byteOffset, tile.bytes.byteLength).getInt16(1024 + offset * 2)
    return value === -32768 ? null : value
  })

  const cache = new GameMapTileCache(), overviewCache = new Map<string, GameMapOverview>()
  const pointers = new Map<number, MapPoint>()
  let mounted = false, generation = 0, selectionGeneration = 0, frame = 0, sliceHeight = 64
  let controller: AbortController | undefined, overviewController: AbortController | undefined, indexController: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined, saveTimer: ReturnType<typeof setTimeout> | undefined
  let poll: ReturnType<typeof setInterval> | undefined, clock: ReturnType<typeof setInterval> | undefined, observer: ResizeObserver | undefined
  let drag: { id: number; start: MapPoint; previous: MapPoint; moved: boolean } | null = null
  let pinch: { x: number; z: number; scale: number; distance: number; midpoint: MapPoint } | null = null

  const labelDimension = (id: string) => DIMENSION_LABELS[id] || id
  const minimumScale = () => Math.max(width.value, canvasHeight.value) / ((MAP_DETAIL_CHUNKS - 2) * 16)
  const storageKey = () => `yzwc-map-preferences:${access.user.value?.id || 0}`
  function currentView(): SavedMapView | null {
    const value = world.value
    if (!value || !dimension.value) return null
    return { world: value.id, dataId: value.data_id, dimension: dimension.value, layer: layer.value, height: height.value,
      x: centerX.value, z: centerZ.value, scale: scale.value, sliceHeight }
  }
  function saveCurrentView() {
    const view = currentView()
    if (!mounted || !view) return
    preferences.value = { ...rememberMapView(preferences.value, view), lighting: lighting.value, grid: grid.value }
    try { localStorage.setItem(storageKey(), JSON.stringify(preferences.value)) } catch { /* 浏览器禁用存储时仍可正常浏览。 */ }
  }
  function queueSave() { if (!mounted) return; clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrentView, 400) }
  function rememberDestination() { const view = currentView(); if (view) preferences.value = rememberMapDestination(preferences.value, view); saveCurrentView() }
  function cancel() { generation++; controller?.abort(); controller = undefined; busy.value = false; clearTimeout(timer) }
  function paintSoon() { if (mounted && !frame) frame = requestAnimationFrame(() => { frame = 0; paint() }) }
  function clampCenter() {
    centerX.value = Math.max(-MAP_BLOCK_LIMIT, Math.min(MAP_BLOCK_LIMIT, centerX.value))
    centerZ.value = Math.max(-MAP_BLOCK_LIMIT, Math.min(MAP_BLOCK_LIMIT, centerZ.value))
    scale.value = Math.max(minimumScale(), Math.min(16, scale.value))
  }
  function schedule() {
    if (!mounted) return
    clampCenter(); cancel(); paintSoon(); queueSave()
    timer = setTimeout(() => { if (!pointers.size) void fetchTiles() }, FETCH_DELAY_MS)
  }
  function measure() {
    const rect = container.value?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    width.value = rect.width; canvasHeight.value = rect.height; clampCenter(); paintSoon()
  }
  function paint() {
    const canvas = surface.value, ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const pixelWidth = Math.round(width.value * ratio), pixelHeight = Math.round(canvasHeight.value * ratio)
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width.value, canvasHeight.value); ctx.imageSmoothingEnabled = false
    const visible = cache.visible(namespace.value, viewport.value)
    for (const tile of visible) ctx.drawImage(mapTileCanvas(tile, lighting.value, dimension.value === 'minecraft:the_nether'),
      width.value / 2 + (tile.x * 16 - centerX.value) * scale.value,
      canvasHeight.value / 2 + (tile.z * 16 - centerZ.value) * scale.value, 16 * scale.value, 16 * scale.value)
    loaded.value = visible.length
    if (grid.value) {
      const step = 16 * scale.value
      ctx.strokeStyle = 'rgba(127,127,127,.4)'; ctx.lineWidth = 1; ctx.beginPath()
      const x0 = ((width.value / 2 - centerX.value * scale.value) % step + step) % step
      const z0 = ((canvasHeight.value / 2 - centerZ.value * scale.value) % step + step) % step
      for (let x = x0; x <= width.value; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, canvasHeight.value) }
      for (let z = z0; z <= canvasHeight.value; z += step) { ctx.moveTo(0, z); ctx.lineTo(width.value, z) }
      ctx.stroke()
    }
    const color = getComputedStyle(canvas).getPropertyValue('--md-sys-color-primary').trim() || '#4469bd'
    for (const landmark of landmarks.value) {
      const x = width.value / 2 + (landmark.x - centerX.value) * scale.value, z = canvasHeight.value / 2 + (landmark.z - centerZ.value) * scale.value
      if (x < -80 || x > width.value + 80 || z < -30 || z > canvasHeight.value + 30) continue
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, z, 5, 0, Math.PI * 2); ctx.fill()
      ctx.font = '12px sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--md-sys-color-surface').trim() || '#fff'
      ctx.strokeText(landmark.name, x + 9, z + 4); ctx.fillText(landmark.name, x + 9, z + 4)
    }
    if (pointed.value) {
      const x = width.value / 2 + (pointed.value.x - centerX.value) * scale.value, z = canvasHeight.value / 2 + (pointed.value.z - centerZ.value) * scale.value
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 10, z); ctx.lineTo(x + 10, z); ctx.moveTo(x, z - 10); ctx.lineTo(x, z + 10); ctx.stroke()
    }
  }

  async function fetchTiles() {
    if (!selected.value || !mounted) return
    error.value = ''
    const scope = namespace.value, remaining = cache.missing(scope, viewport.value)
    if (!remaining.length) { paintSoon(); return }
    const token = ++generation, abort = new AbortController(); controller = abort
    const query = { world: worldId.value, dimension: dimension.value, layer: layer.value, height: height.value }
    busy.value = true; error.value = ''; paintSoon()
    try {
      for (const rect of remaining) {
        let after: number | null = -1
        do {
          const page: GameMapTilePage = await $fetch('/api/admin/game-maps/tiles', { query: { ...query,
            min_x: rect.minX, max_x: rect.maxX, min_z: rect.minZ, max_z: rect.maxZ, after }, signal: abort.signal })
          if (token !== generation || scope !== namespace.value) return
          for (const tile of page.tiles) {
            const binary = atob(tile.data)
            if (binary.length !== MAP_TILE_BYTES) throw new Error('地图数据长度无效')
            cache.put(scope, tile.x, tile.z, Uint8Array.from(binary, char => char.charCodeAt(0)))
          }
          tileVersion.value++
          paintSoon(); after = page.next
        } while (after !== null)
        cache.complete(scope, rect)
      }
    } catch (failure: any) {
      if (!abort.signal.aborted && token === generation) error.value = failure?.data?.statusMessage || failure?.message || '地形读取失败，可重试；已显示的区域仍可浏览。'
    } finally { if (token === generation) { busy.value = false; paintSoon() } }
  }

  async function loadOverview(force = false): Promise<GameMapOverview | null> {
    if (!selected.value) { overview.value = null; return null }
    const scope = namespace.value
    if (!force && overviewCache.has(scope)) {
      overviewController?.abort(); overviewController = undefined; overviewBusy.value = false; overviewError.value = ''
      overview.value = overviewCache.get(scope)!; return overview.value
    }
    overviewController?.abort()
    const abort = new AbortController(); overviewController = abort
    overviewBusy.value = true; overviewError.value = ''
    try {
      const value = await $fetch<GameMapOverview>('/api/admin/game-maps/overview', { query: { world: worldId.value,
        dimension: dimension.value, layer: layer.value, height: height.value }, signal: abort.signal })
      if (scope !== namespace.value || abort.signal.aborted) return null
      if (overviewCache.size >= MAX_OVERVIEW_CACHE) overviewCache.delete(overviewCache.keys().next().value!)
      overviewCache.set(scope, value); overview.value = value
      return value
    } catch (failure: any) {
      if (!abort.signal.aborted) overviewError.value = failure?.data?.statusMessage || '区域总览读取失败'
      return null
    } finally { if (overviewController === abort) overviewBusy.value = false }
  }
  function nearestHeight(value: number): number { return heights.value.reduce((a, b) => Math.abs(b - value) < Math.abs(a - value) ? b : a, heights.value[0] ?? 0) }

  async function setWorld(id: string, remember = true) {
    if (remember) saveCurrentView()
    const token = ++selectionGeneration
    clearTimeout(saveTimer)
    cancel(); overviewController?.abort(); overview.value = null; pointed.value = null; hover.value = null; error.value = ''
    worldId.value = id
    const saved = preferences.value.views.filter(value => value.world === id && value.dataId === world.value?.data_id).at(-1)
    sliceHeight = saved?.sliceHeight ?? 64
    dimension.value = saved && dimensions.value.includes(saved.dimension) ? saved.dimension
      : dimensions.value.includes('minecraft:overworld') ? 'minecraft:overworld' : dimensions.value[0] || ''
    layer.value = saved && layers.value.includes(saved.layer) ? saved.layer : layers.value.includes('SURFACE') ? 'SURFACE' : layers.value[0] || 'SURFACE'
    height.value = nearestHeight(saved?.height ?? (layer.value === 'SURFACE' || layer.value === 'ROOF' ? 0 : 64))
    if (layer.value === 'CAVE' || layer.value === 'FIXED') sliceHeight = height.value
    await nextTick(); measure()
    if (token !== selectionGeneration || worldId.value !== id) return
    if (saved && selected.value) { centerX.value = saved.x; centerZ.value = saved.z; scale.value = saved.scale; schedule(); void loadOverview() }
    else {
      const value = await loadOverview()
      if (token !== selectionGeneration) return
      if (value?.cells.length) { centerX.value = value.focus_x; centerZ.value = value.focus_z; scale.value = mapFitScale(viewBounds(), width.value, canvasHeight.value) }
      else { centerX.value = 0; centerZ.value = 0; scale.value = 2 }
      schedule()
    }
  }
  function viewBounds(): MapRectangle {
    const value = selected.value
    return value ? { minX: value.min_x, minZ: value.min_z, maxX: value.max_x, maxZ: value.max_z } : viewport.value
  }
  async function setDimension(id: string) {
    saveCurrentView(); const token = ++selectionGeneration; clearTimeout(saveTimer); cancel(); overviewController?.abort(); overview.value = null; pointed.value = null; hover.value = null; error.value = ''
    dimension.value = id
    const saved = preferences.value.views.find(value => value.world === worldId.value && value.dataId === world.value?.data_id && value.dimension === id)
    sliceHeight = saved?.sliceHeight ?? 64
    layer.value = saved && layers.value.includes(saved.layer) ? saved.layer : layers.value.includes('SURFACE') ? 'SURFACE' : layers.value[0] || 'SURFACE'
    height.value = nearestHeight(saved?.height ?? (layer.value === 'SURFACE' || layer.value === 'ROOF' ? 0 : sliceHeight))
    if (saved) { centerX.value = saved.x; centerZ.value = saved.z; scale.value = saved.scale; schedule(); void loadOverview() }
    else { const value = await loadOverview(); if (token !== selectionGeneration || dimension.value !== id) return; if (value) { centerX.value = value.focus_x; centerZ.value = value.focus_z; scale.value = mapFitScale(viewBounds(), width.value, canvasHeight.value) }; schedule() }
  }
  function setLayer(value: GameMapLayer) {
    saveCurrentView(); selectionGeneration++; cancel(); overviewController?.abort(); overview.value = null; hover.value = null; error.value = ''
    if (layer.value === 'CAVE' || layer.value === 'FIXED') sliceHeight = height.value
    layer.value = value; height.value = nearestHeight(value === 'SURFACE' || value === 'ROOF' ? 0 : sliceHeight)
    schedule(); void loadOverview()
  }
  function chooseHeight(value: number) {
    if (!Number.isFinite(value)) return
    const nearest = nearestHeight(value)
    if (nearest === height.value) return
    selectionGeneration++; cancel(); overviewController?.abort(); overview.value = null
    height.value = nearest; sliceHeight = nearest; schedule()
    if (overviewOpen.value) void loadOverview()
  }
  async function goToRecorded() {
    const scope = namespace.value, value = await loadOverview()
    if (!value?.cells.length || scope !== namespace.value) return
    centerX.value = value.focus_x; centerZ.value = value.focus_z; pointed.value = null
    scale.value = mapFitScale(viewBounds(), width.value, canvasHeight.value); schedule(); rememberDestination()
  }
  function chooseRegion(point: MapPoint) {
    centerX.value = point.x; centerZ.value = point.z; pointed.value = point
    scale.value = Math.max(minimumScale(), 2); schedule(); rememberDestination()
    container.value?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }
  function moveTo() {
    const point = parseMapLocation(location.value)
    if (!point) { showToast('请输入 X Z、X Y Z 或游戏内复制的坐标文本', 'error'); return }
    if (point.y !== undefined && (layer.value === 'CAVE' || layer.value === 'FIXED')) chooseHeight(point.y)
    centerX.value = point.x; centerZ.value = point.z; pointed.value = { x: point.x, z: point.z }; schedule(); rememberDestination()
  }
  async function jumpSaved(value: SavedMapView) {
    if (value.world !== worldId.value) await setWorld(value.world)
    if (value.dimension !== dimension.value) await setDimension(value.dimension)
    if (layers.value.includes(value.layer)) setLayer(value.layer)
    chooseHeight(value.height); centerX.value = value.x; centerZ.value = value.z; scale.value = value.scale; pointed.value = { x: value.x, z: value.z }
    schedule(); rememberDestination()
    container.value?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }

  function zoom(factor: number, point = { x: width.value / 2, z: canvasHeight.value / 2 }) {
    const anchorX = centerX.value + (point.x - width.value / 2) / scale.value, anchorZ = centerZ.value + (point.z - canvasHeight.value / 2) / scale.value
    scale.value *= factor; clampCenter()
    centerX.value = anchorX - (point.x - width.value / 2) / scale.value; centerZ.value = anchorZ - (point.z - canvasHeight.value / 2) / scale.value; schedule()
  }
  function screenPoint(event: PointerEvent | WheelEvent): MapPoint {
    const rect = surface.value!.getBoundingClientRect(); return { x: event.clientX - rect.left, z: event.clientY - rect.top }
  }
  function wheel(event: WheelEvent) { event.preventDefault(); zoom(event.deltaY < 0 ? 1.25 : 0.8, screenPoint(event)) }
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || pointers.size >= 2) return
    cancel(); surface.value?.focus({ preventScroll: true }); surface.value?.setPointerCapture(event.pointerId)
    const point = screenPoint(event); pointers.set(event.pointerId, point)
    if (pointers.size === 1) drag = { id: event.pointerId, start: point, previous: point, moved: false }
    else {
      const [first, second] = [...pointers.values()] as [MapPoint, MapPoint]
      pinch = { x: centerX.value, z: centerZ.value, scale: scale.value, distance: Math.hypot(second.x - first.x, second.z - first.z),
        midpoint: { x: (first.x + second.x) / 2, z: (first.z + second.z) / 2 } }
      if (drag) drag.moved = true
    }
  }
  function pointerMove(event: PointerEvent) {
    const point = screenPoint(event)
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, point)
    if (pointers.size === 2 && pinch) {
      const [first, second] = [...pointers.values()] as [MapPoint, MapPoint]
      const value = mapPinchView(pinch, { x: (first.x + second.x) / 2, z: (first.z + second.z) / 2 },
        Math.hypot(second.x - first.x, second.z - first.z), width.value, canvasHeight.value, minimumScale())
      centerX.value = value.x; centerZ.value = value.z; scale.value = value.scale; clampCenter(); paintSoon(); queueSave()
    } else if (drag?.id === event.pointerId) {
      centerX.value -= (point.x - drag.previous.x) / scale.value; centerZ.value -= (point.z - drag.previous.z) / scale.value
      if (Math.hypot(point.x - drag.start.x, point.z - drag.start.z) > 4) drag.moved = true
      drag.previous = point; clampCenter(); paintSoon(); queueSave()
    }
    hover.value = { x: Math.floor(centerX.value + (point.x - width.value / 2) / scale.value), z: Math.floor(centerZ.value + (point.z - canvasHeight.value / 2) / scale.value) }
  }
  function pointerUp(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return
    if (event.type === 'pointerup' && pointers.size === 1 && drag && !drag.moved) {
      const point = screenPoint(event)
      pointed.value = { x: Math.floor(centerX.value + (point.x - width.value / 2) / scale.value), z: Math.floor(centerZ.value + (point.z - canvasHeight.value / 2) / scale.value) }
      paintSoon()
    }
    pointers.delete(event.pointerId); pinch = null
    if (pointers.size) { const [id, point] = [...pointers.entries()][0]!; drag = { id, start: point, previous: point, moved: true } }
    else { drag = null; schedule() }
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === '+' || event.key === '=') zoom(1.25)
    else if (event.key === '-') zoom(0.8)
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      centerX.value += (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0) * 80 / scale.value
      centerZ.value += (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0) * 80 / scale.value; schedule()
    } else return
    event.preventDefault()
  }

  function openLandmark() {
    if (preferences.value.landmarks.length >= MAX_MAP_LANDMARKS) { showToast(`最多保存 ${MAX_MAP_LANDMARKS} 个地标`, 'error'); return }
    landmarkName.value = ''; landmarkOpen.value = true
  }
  function saveLandmark() {
    const view = currentView(), name = landmarkName.value.trim()
    if (!view || !name || name.length > 40) { showToast('请输入 1 至 40 字的地标名称', 'error'); return }
    const landmark: MapLandmark = { ...view, x: Math.floor(coordinate.value.x), z: Math.floor(coordinate.value.z), id: crypto.randomUUID(), name }
    preferences.value.landmarks.push(landmark); landmarkOpen.value = false; saveCurrentView(); paintSoon(); showToast('已在此浏览器保存地标')
  }
  function removeLandmark(id: string) { preferences.value.landmarks = preferences.value.landmarks.filter(value => value.id !== id); saveCurrentView(); paintSoon() }
  async function copyText(text: string, message: string) {
    try { await navigator.clipboard.writeText(text); showToast(message) }
    catch { showToast(`复制失败，可手动复制：${text}`, 'error') }
  }
  function copyCoordinates() { return copyText(`X: ${Math.floor(coordinate.value.x)}${pointerElevation.value === null ? '' : ` Y: ${pointerElevation.value}`} Z: ${Math.floor(coordinate.value.z)}`, '已复制坐标') }
  function copyUploadCommand() { return copyText(MAP_UPLOAD_COMMAND, '已复制服务器控制台上传命令') }
  async function requestUpload() {
    if (!canRequestUpload.value || uploadPending.value) return
    uploadPending.value = true
    uploadRequestedAt = Date.now()
    try {
      uploadRequest.value = await $fetch<GameMapUploadRequest>('/api/admin/game-map-data/upload', { method: 'POST' })
      showToast(uploadRequest.value.message, uploadRequest.value.status === 'failed' ? 'error' : 'info')
      void refreshWorlds(false)
    } catch (failure: any) { showToast(failure?.data?.statusMessage || '地图上传请求失败', 'error') }
    finally { uploadPending.value = false }
  }
  async function toggleOverview() { overviewOpen.value = !overviewOpen.value; if (overviewOpen.value) await loadOverview() }
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await card.value?.requestFullscreen() }
    catch { showToast('浏览器暂不支持全屏地图', 'info') }
  }
  function fullscreenChanged() { fullScreen.value = document.fullscreenElement === card.value; void nextTick(() => { measure(); schedule() }) }
  function visibleChanged() { if (!document.hidden) { now.value = Date.now(); void refreshWorlds(false) } }

  async function refreshWorlds(force = true) {
    if (!mounted || refreshing.value) return
    refreshing.value = true
    const abort = new AbortController(); indexController = abort
    try {
      const next = await $fetch<GameMapIndex>('/api/admin/game-maps', { signal: abort.signal })
      if (!mounted) return
      const old = index.value, previousWorld = world.value
      for (const item of next.worlds) {
        const before = old?.worlds.find(value => value.id === item.id)
        if (force || !before || before.data_id !== item.data_id || before.last_activity !== item.last_activity || before.upload_batch !== item.upload_batch || before.source_revision !== item.source_revision) {
          cache.invalidate(item.id, Boolean(before && before.data_id !== item.data_id))
          for (const key of overviewCache.keys()) if (key.startsWith(item.id + '|')) overviewCache.delete(key)
        }
      }
      for (const before of old?.worlds || []) if (!next.worlds.some(item => item.id === before.id)) cache.invalidate(before.id, true)
      index.value = next; now.value = Date.now(); statusError.value = ''
      tileVersion.value++
      if (uploadRequestedAt && next.worlds.some(value => value.last_success >= uploadRequestedAt && !value.syncing)) uploadRequest.value = null
      preferences.value = pruneMapPreferences(preferences.value, next.worlds)
      if (!world.value) await setWorld(next.worlds.some(value => value.id === preferences.value.lastWorld) ? preferences.value.lastWorld : next.worlds[0]?.id || '', false)
      else if (previousWorld?.data_id !== world.value.data_id || !selected.value) await setWorld(worldId.value, false)
      else {
        const changed = force || previousWorld?.last_activity !== world.value.last_activity || previousWorld?.upload_batch !== world.value.upload_batch || previousWorld?.source_revision !== world.value.source_revision
        if (changed) { schedule(); if (overviewOpen.value) void loadOverview(true) }
      }
    } catch (failure: any) {
      if (!abort.signal.aborted) statusError.value = failure?.data?.statusMessage || '快照状态读取失败，稍后会自动重试'
    } finally { if (!abort.signal.aborted) refreshing.value = false }
  }

  watch([lighting, grid], () => { paintSoon(); queueSave() })
  watch([centerX, centerZ, scale], queueSave)
  onMounted(async () => {
    mounted = true
    try { preferences.value = readMapPreferences(localStorage.getItem(storageKey())) } catch { preferences.value = emptyMapPreferences() }
    lighting.value = preferences.value.lighting; grid.value = preferences.value.grid
    observer = new ResizeObserver(() => { measure(); schedule() })
    if (container.value) observer.observe(container.value)
    document.addEventListener('fullscreenchange', fullscreenChanged); document.addEventListener('visibilitychange', visibleChanged)
    clock = setInterval(() => { now.value = Date.now() }, 10_000)
    poll = setInterval(() => { if (!document.hidden) void refreshWorlds(false) }, POLL_INTERVAL_MS)
    await refreshWorlds(false)
  })
  onBeforeUnmount(() => {
    saveCurrentView(); mounted = false; cancel(); clearTimeout(saveTimer); clearInterval(poll); clearInterval(clock)
    overviewController?.abort(); indexController?.abort(); observer?.disconnect(); if (frame) cancelAnimationFrame(frame)
    document.removeEventListener('fullscreenchange', fullscreenChanged); document.removeEventListener('visibilitychange', visibleChanged)
    cache.clear(); overviewCache.clear(); pointers.clear()
  })

  return { index, worlds, worldId, world, dimension, dimensions, layers, layer, height, heights, heightIndex, selected,
    centerX, centerZ, scale, location, card, surface, container, busy, refreshing, error, statusError, loaded,
    lighting, grid, overviewOpen, overview, overviewBusy, overviewError, viewport, fullScreen, hover, pointed,
    coordinateText, pointerElevation, landmarks, recent, landmarkOpen, landmarkName, snapshotAge, stale, stalled, syncText,
    uploadPending, uploadRequest, canRequestUpload, canViewSettings, labelDimension, setWorld, setDimension, setLayer,
    chooseHeight, goToRecorded, chooseRegion, moveTo, jumpSaved, zoom, wheel, pointerDown, pointerMove, pointerUp, keydown,
    openLandmark, saveLandmark, removeLandmark, copyCoordinates, copyUploadCommand, requestUpload,
    toggleOverview, toggleFullscreen, refreshWorlds, loadOverview, schedule }
}
