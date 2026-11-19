/** 地图协议的跨端类型与坐标边界；浏览器只读取已上传的地形和玩家位置快照。 */
export const MAP_CHUNK_LIMIT = 1_874_999
export const MAP_MAX_VIEW_CHUNKS = 256
export const MAP_TILE_BYTES = 1792
export const MAP_BATCH_TILES = 128
export const MAP_PAGE_TILES = 256
export const MAP_OVERVIEW_SIDE = 64
export const MAP_PLAYER_BATCH = 256
export const MAP_MAX_PLAYERS = 4096
export const MAP_UPLOAD_COMMAND = 'yzwc map upload'
export const MAP_LAYERS = ['SURFACE', 'ROOF', 'CAVE', 'FIXED'] as const
export type GameMapLayer = typeof MAP_LAYERS[number]
export interface GameMapDimension { id: string; min_y: number; max_y: number }
export interface GameMapLayerSummary {
  dimension: string; layer: GameMapLayer; height: number; tile_count: number
  min_x: number; min_z: number; max_x: number; max_z: number
}
export interface GameMapWorld {
  id: string; data_id: string; name: string; dimensions: GameMapDimension[]; layers: GameMapLayerSummary[]
  source_revision: number; upload_batch: number; last_success: number; last_activity: number; syncing: boolean; tile_count: number
  player_count: number; player_updated_at: number
}
export const MAP_PLAYER_SOURCES = ['login', 'logout', 'upload'] as const
export type GameMapPlayerSource = typeof MAP_PLAYER_SOURCES[number]
export interface GameMapPlayer {
  uuid: string; name: string; dimension: string; x: number; y: number; z: number
  recorded_at: number; source: GameMapPlayerSource
}
export interface GameMapPlayers { world: string; data_id: string; players: GameMapPlayer[] }
export function mapPlayerSourceLabel(source: GameMapPlayerSource): string {
  return { login: '上线后', logout: '下线前', upload: '地图上传时' }[source]
}
export interface GameMapTile { x: number; z: number; data: string }
export interface GameMapTilePage { tiles: GameMapTile[]; next: number | null }
export interface GameMapOverviewCell {
  /** 区域索引与定位点均以区块为单位。 */
  x: number; z: number; count: number; focus_x: number; focus_z: number
}
export interface GameMapOverview {
  cell_size: number; cells: GameMapOverviewCell[]
  min_x: number; min_z: number; max_x: number; max_z: number
  /** 默认定位点以方块为单位，位于真实已记录瓦片中心。 */
  focus_x: number; focus_z: number
}
export interface GameMapUploadRequest {
  status: 'requested' | 'waiting' | 'failed'; message: string
}
export interface GameMapReset extends GameMapUploadRequest {
  id: string; at: number; world: string | null; world_name: string
  removed_worlds: number; removed_tiles: number; removed_players: number
}
export interface GameMapIndex {
  worlds: GameMapWorld[]; reset: GameMapReset | null
  diagnostics: { game_api_configured: boolean; panel_bound: boolean }
}
export function mapLayerLabel(layer: GameMapLayer): string {
  return { SURFACE: '地表', ROOF: '顶层／下界顶板', CAVE: '洞穴', FIXED: '地下高度切片' }[layer]
}
export function mapLayerDescription(layer: GameMapLayer): string {
  return {
    SURFACE: '查看地表建筑和地形；下界显示基岩顶板下方的地形。',
    ROOF: '查看最上层地形；下界包含基岩顶板和顶板上的建筑。',
    CAVE: '从所选高度向下寻找洞穴开口，再显示洞穴地面。',
    FIXED: '从所选高度向下显示第一个可见方块，适合逐层检查地下建筑。',
  }[layer]
}
