/** 地图协议的跨端类型与坐标边界；浏览器只读取已上传的地形快照。 */
export const MAP_CHUNK_LIMIT = 1_874_999
export const MAP_MAX_VIEW_CHUNKS = 256
export const MAP_TILE_BYTES = 1792
export const MAP_BATCH_TILES = 128
export const MAP_PAGE_TILES = 256
export const MAP_LAYERS = ['SURFACE', 'ROOF', 'CAVE', 'FIXED'] as const
export type GameMapLayer = typeof MAP_LAYERS[number]
export interface GameMapDimension { id: string; min_y: number; max_y: number }
export interface GameMapLayerSummary {
  dimension: string; layer: GameMapLayer; height: number; tile_count: number
  min_x: number; min_z: number; max_x: number; max_z: number
}
export interface GameMapWorld {
  id: string; name: string; dimensions: GameMapDimension[]; layers: GameMapLayerSummary[]
  last_success: number; last_activity: number; syncing: boolean; tile_count: number
}
export interface GameMapTile { x: number; z: number; data: string }
export interface GameMapTilePage { tiles: GameMapTile[]; next: number | null }
export function mapLayerLabel(layer: GameMapLayer): string {
  return { SURFACE: '地表', ROOF: '顶层／下界顶板', CAVE: '洞穴', FIXED: '地下高度切片' }[layer]
}
