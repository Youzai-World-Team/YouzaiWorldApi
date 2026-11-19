import { createError } from 'h3'
import { MAP_BATCH_TILES, MAP_CHUNK_LIMIT, MAP_LAYERS, MAP_MAX_VIEW_CHUNKS, MAP_TILE_BYTES,
  MAP_PLAYER_BATCH, MAP_PLAYER_SOURCES, type GameMapPlayer, type GameMapPlayerSource,
  type GameMapDimension, type GameMapLayer } from '#shared/game-map'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DIMENSION = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const PLAYER_CLOCK_TOLERANCE_MS = 5 * 60_000
function invalid(): never { throw createError({ statusCode: 400, statusMessage: '地图参数或瓦片格式无效' }) }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid()
  return value
}
function text(value: unknown, max: number, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || (pattern && !pattern.test(value))) invalid()
  return value
}
export function gameMapId(value: unknown): string { return text(value, 36, UUID) }
export interface MapPlayerUpload { worldId: string; dataId: string; players: GameMapPlayer[] }
/** 玩家快照由服务端单独签名上传，不混入只接受区块存储的地形协议。 */
export function parseMapPlayers(value: unknown): MapPlayerUpload {
  const body = record(value)
  if (body.version !== 2 || body.source !== 'minecraft_server'
    || !Array.isArray(body.players) || !body.players.length || body.players.length > MAP_PLAYER_BATCH) invalid()
  const worldId = gameMapId(body.world_id), dataId = gameMapId(body.data_id), ids = new Set<string>()
  const coordinate = (value: unknown, min: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid()
    return value
  }
  const latest = Date.now() + PLAYER_CLOCK_TOLERANCE_MS
  const players = body.players.map((raw): GameMapPlayer => {
    const item = record(raw), uuid = gameMapId(item.uuid), name = text(item.name, 64)
    if (ids.has(uuid) || /[\u0000-\u001f\u007f]/.test(name)) invalid()
    ids.add(uuid)
    const dimension = text(item.dimension, 128, DIMENSION)
    if (dimension === 'youzaiworldcore:login_hall' || !MAP_PLAYER_SOURCES.includes(item.source as GameMapPlayerSource)) invalid()
    return { uuid, name, dimension, x: coordinate(item.x, -MAP_CHUNK_LIMIT * 16, MAP_CHUNK_LIMIT * 16),
      y: coordinate(item.y, -4096, 4095), z: coordinate(item.z, -MAP_CHUNK_LIMIT * 16, MAP_CHUNK_LIMIT * 16),
      recorded_at: integer(item.recorded_at, 1, latest), source: item.source as GameMapPlayerSource }
  })
  return { worldId, dataId, players }
}
export interface UploadTile { dimension: string; layer: GameMapLayer; height: number; x: number; z: number; revision: number; data: Buffer }
export interface MapUpload {
  worldId: string; runId: string; phase: 'begin' | 'tiles' | 'complete'; batch: number
  revision: number; name: string; dimensions: GameMapDimension[]; tiles: UploadTile[]
}
/** 在 SQLite 事务前完整校验整批数据，拒绝部分写入。 */
export function parseMapUpload(value: unknown): MapUpload {
  const body = record(value)
  if (body.version !== 2 || body.source !== 'minecraft_chunk_storage' || !['begin', 'tiles', 'complete'].includes(String(body.phase))) invalid()
  const output: MapUpload = { worldId: gameMapId(body.world_id), runId: gameMapId(body.run_id),
    phase: body.phase as MapUpload['phase'], batch: integer(body.batch, 0, 1_000_000), revision: integer(body.revision, 0, Number.MAX_SAFE_INTEGER), name: '', dimensions: [], tiles: [] }
  if (output.phase === 'begin') {
    if (output.batch !== 0) invalid()
    output.name = text(body.name, 128)
    if (!Array.isArray(body.dimensions) || !body.dimensions.length || body.dimensions.length > 128) invalid()
    const ids = new Set<string>()
    output.dimensions = body.dimensions.map((raw) => {
      const item = record(raw)
      const id = text(item.id, 128, DIMENSION)
      if (ids.has(id)) invalid()
      ids.add(id)
      const min = integer(item.min_y, -4096, 4095), max = integer(item.max_y, min, 4095)
      return { id, min_y: min, max_y: max }
    })
  } else if (output.phase === 'tiles') {
    if (!Array.isArray(body.tiles) || !body.tiles.length || body.tiles.length > MAP_BATCH_TILES) invalid()
    const keys = new Set<string>()
    output.tiles = body.tiles.map((raw) => {
      const item = record(raw)
      const dimension = text(item.dimension, 128, DIMENSION)
      if (!MAP_LAYERS.includes(item.layer as GameMapLayer)) invalid()
      const layer = item.layer as GameMapLayer, height = integer(item.height, -4096, 4095)
      if ((layer === 'SURFACE' || layer === 'ROOF') && height !== 0) invalid()
      const x = integer(item.x, -MAP_CHUNK_LIMIT, MAP_CHUNK_LIMIT), z = integer(item.z, -MAP_CHUNK_LIMIT, MAP_CHUNK_LIMIT)
      const key = `${dimension}|${layer}|${height}|${x}|${z}`
      if (keys.has(key)) invalid()
      keys.add(key)
      const encoded = text(item.data, Math.ceil(MAP_TILE_BYTES / 3) * 4, BASE64)
      const data = Buffer.from(encoded, 'base64')
      if (data.length !== MAP_TILE_BYTES || data.toString('base64') !== encoded) invalid()
      for (let i = 0; i < 256; i++) {
        const elevation = data.readInt16BE(1024 + i * 2), alpha = data[i * 4 + 3]
        if (alpha !== 0 && alpha !== 255) invalid()
        if (elevation !== -32768 && (elevation < -4096 || elevation > 4095)) invalid()
      }
      return { dimension, layer, height, x, z, revision: integer(item.revision, 1, output.revision), data }
    })
  }
  return output
}

export interface MapViewport { worldId: string; dimension: string; layer: GameMapLayer; height: number; minX: number; minZ: number; maxX: number; maxZ: number; after: number }
export type MapSelection = Pick<MapViewport, 'worldId' | 'dimension' | 'layer' | 'height'>
export function parseMapSelection(query: Record<string, unknown>): MapSelection {
  const worldId = gameMapId(query.world), dimension = text(query.dimension, 128, DIMENSION)
  if (!MAP_LAYERS.includes(query.layer as GameMapLayer)) invalid()
  const layer = query.layer as GameMapLayer
  if (typeof query.height !== 'string' || !/^-?\d+$/.test(query.height)) invalid()
  const height = integer(Number(query.height), -4096, 4095)
  if ((layer === 'SURFACE' || layer === 'ROOF') && height !== 0) invalid()
  return { worldId, dimension, layer, height }
}
/** 视口最多 256×256 区块，按坐标分页，负数坐标使用与 Java 相同的向下取整语义。 */
export function parseMapViewport(query: Record<string, unknown>): MapViewport {
  const number = (key: string, min: number, max: number) => {
    if (typeof query[key] !== 'string' || !/^-?\d+$/.test(query[key] as string)) invalid()
    return integer(Number(query[key]), min, max)
  }
  const { worldId, dimension, layer, height } = parseMapSelection(query)
  const minX = number('min_x', -MAP_CHUNK_LIMIT, MAP_CHUNK_LIMIT), maxX = number('max_x', minX, MAP_CHUNK_LIMIT)
  const minZ = number('min_z', -MAP_CHUNK_LIMIT, MAP_CHUNK_LIMIT), maxZ = number('max_z', minZ, MAP_CHUNK_LIMIT)
  if (maxX - minX >= MAP_MAX_VIEW_CHUNKS || maxZ - minZ >= MAP_MAX_VIEW_CHUNKS) invalid()
  const after = query.after === undefined ? -1 : number('after', -1, (maxX - minX + 1) * (maxZ - minZ + 1) - 1)
  return { worldId, dimension, layer, height, minX, minZ, maxX, maxZ, after }
}
