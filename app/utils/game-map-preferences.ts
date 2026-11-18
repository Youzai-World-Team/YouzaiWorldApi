import { MAP_LAYERS, type GameMapLayer, type GameMapWorld } from '#shared/game-map'
import { MAP_BLOCK_LIMIT } from '#shared/game-map-view'

export const MAX_MAP_LANDMARKS = 50
export const MAX_MAP_RECENT = 8
const MAX_MAP_SAVED_VIEWS = 192

export interface SavedMapView {
  world: string; dataId: string; dimension: string; layer: GameMapLayer; height: number
  x: number; z: number; scale: number
  sliceHeight?: number
}
export interface MapLandmark extends SavedMapView { id: string; name: string }
export interface MapPreferences {
  lastWorld: string; lighting: boolean; grid: boolean; views: SavedMapView[]
  landmarks: MapLandmark[]; recent: SavedMapView[]
}

export function emptyMapPreferences(): MapPreferences {
  return { lastWorld: '', lighting: false, grid: false, views: [], landmarks: [], recent: [] }
}
export function mapViewKey(view: Pick<SavedMapView, 'world' | 'dimension'>): string { return `${view.world}|${view.dimension}` }

function validView(value: unknown): value is SavedMapView {
  if (!value || typeof value !== 'object') return false
  const view = value as SavedMapView
  return typeof view.world === 'string' && typeof view.dataId === 'string' && typeof view.dimension === 'string'
    && MAP_LAYERS.includes(view.layer) && Number.isInteger(view.height) && view.height >= -4096 && view.height <= 4095
    && [view.x, view.z].every(number => Number.isFinite(number) && Math.abs(number) <= MAP_BLOCK_LIMIT)
    && Number.isFinite(view.scale) && view.scale > 0 && view.scale <= 16
    && (view.sliceHeight === undefined || (Number.isInteger(view.sliceHeight) && view.sliceHeight >= -4096 && view.sliceHeight <= 4095))
}

/** 浏览位置与地标按后台账户保存在当前浏览器，地图被清空后旧的数据身份不再匹配。 */
export function readMapPreferences(raw: string | null): MapPreferences {
  const fallback = emptyMapPreferences()
  try {
    const value = JSON.parse(raw || '{}')
    if (!value || typeof value !== 'object') return fallback
    return {
      lastWorld: typeof value.lastWorld === 'string' ? value.lastWorld : '',
      lighting: value.lighting === true, grid: value.grid === true,
      views: Array.isArray(value.views) ? value.views.filter(validView).slice(-MAX_MAP_SAVED_VIEWS) : [],
      landmarks: Array.isArray(value.landmarks) ? value.landmarks.filter((item: unknown) => validView(item)
        && typeof (item as MapLandmark).id === 'string' && typeof (item as MapLandmark).name === 'string'
        && (item as MapLandmark).name.trim().length > 0 && (item as MapLandmark).name.length <= 40).slice(0, MAX_MAP_LANDMARKS) : [],
      recent: Array.isArray(value.recent) ? value.recent.filter(validView).slice(0, MAX_MAP_RECENT) : [],
    }
  } catch { return fallback }
}

export function pruneMapPreferences(value: MapPreferences, worlds: GameMapWorld[]): MapPreferences {
  const valid = (view: SavedMapView) => worlds.some(world => world.id === view.world && world.data_id === view.dataId
    && world.dimensions.some(dimension => dimension.id === view.dimension))
  return { ...value, views: value.views.filter(valid), landmarks: value.landmarks.filter(valid), recent: value.recent.filter(valid) }
}

export function rememberMapView(value: MapPreferences, view: SavedMapView): MapPreferences {
  return { ...value, lastWorld: view.world,
    views: [...value.views.filter(old => mapViewKey(old) !== mapViewKey(view)), view].slice(-MAX_MAP_SAVED_VIEWS) }
}

export function rememberMapDestination(value: MapPreferences, view: SavedMapView): MapPreferences {
  return { ...value, recent: [view, ...value.recent.filter(old => old.world !== view.world || old.dimension !== view.dimension
    || old.layer !== view.layer || old.height !== view.height || Math.hypot(old.x - view.x, old.z - view.z) > 16)].slice(0, MAX_MAP_RECENT) }
}
