import { MAP_CHUNK_LIMIT, MAP_OVERVIEW_SIDE, type GameMapOverviewCell } from './game-map'

export interface MapRectangle { minX: number; minZ: number; maxX: number; maxZ: number }
export interface MapPoint { x: number; z: number }
export const MAP_BLOCK_LIMIT = MAP_CHUNK_LIMIT * 16
export const MAP_DETAIL_CHUNKS = 64

/** 去掉已完整读取的范围，只请求新进入视口的条带；区块范围包含两端。 */
export function uncoveredMapRectangles(view: MapRectangle, covered: MapRectangle[]): MapRectangle[] {
  let remaining = [view]
  for (const old of covered) {
    const next: MapRectangle[] = []
    for (const part of remaining) {
      const left = Math.max(part.minX, old.minX), right = Math.min(part.maxX, old.maxX)
      const top = Math.max(part.minZ, old.minZ), bottom = Math.min(part.maxZ, old.maxZ)
      if (left > right || top > bottom) { next.push(part); continue }
      if (part.minZ < top) next.push({ ...part, maxZ: top - 1 })
      if (bottom < part.maxZ) next.push({ ...part, minZ: bottom + 1 })
      if (part.minX < left) next.push({ minX: part.minX, maxX: left - 1, minZ: top, maxZ: bottom })
      if (right < part.maxX) next.push({ minX: right + 1, maxX: part.maxX, minZ: top, maxZ: bottom })
    }
    remaining = next
    // 范围过于碎片化时重新读取整张视口，避免发出大量小请求。
    if (remaining.length > 24) return [view]
    if (!remaining.length) break
  }
  return remaining
}

export function mapRectangleContains(rect: MapRectangle, x: number, z: number): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ
}

/** 以二的幂划分区域，负坐标也使用向下取整；全存档总览至多 64×64 个区域。 */
export function mapOverviewCellSize(bounds: MapRectangle): number {
  let size = 1
  const cells = () => Math.max(
    Math.floor(bounds.maxX / size) - Math.floor(bounds.minX / size) + 1,
    Math.floor(bounds.maxZ / size) - Math.floor(bounds.minZ / size) + 1,
  )
  while (cells() > MAP_OVERVIEW_SIDE) size *= 2
  return size
}

/** 优先进入记录最密集的区域；返回真实瓦片的中心，避免落在外接矩形的空白中。 */
export function mapOverviewFocus(cells: GameMapOverviewCell[]): MapPoint | null {
  const cell = cells.reduce<GameMapOverviewCell | undefined>((best, value) => !best || value.count > best.count ? value : best, undefined)
  return cell ? { x: cell.focus_x * 16 + 8, z: cell.focus_z * 16 + 8 } : null
}

export function mapFitScale(bounds: MapRectangle, width: number, height: number): number {
  const minimum = Math.max(width, height) / ((MAP_DETAIL_CHUNKS - 2) * 16)
  return Math.max(minimum, Math.min(4, width / ((bounds.maxX - bounds.minX + 3) * 16), height / ((bounds.maxZ - bounds.minZ + 3) * 16)))
}

/** 双指的中点与距离同时变化时，保持手势开始时指下的世界坐标。 */
export function mapPinchView(start: { x: number; z: number; scale: number; distance: number; midpoint: MapPoint },
  midpoint: MapPoint, distance: number, width: number, height: number, minimum: number): { x: number; z: number; scale: number } {
  const scale = Math.max(minimum, Math.min(16, start.scale * distance / Math.max(1, start.distance)))
  const anchorX = start.x + (start.midpoint.x - width / 2) / start.scale
  const anchorZ = start.z + (start.midpoint.z - height / 2) / start.scale
  return { scale, x: anchorX - (midpoint.x - width / 2) / scale, z: anchorZ - (midpoint.z - height / 2) / scale }
}

/** 支持两个坐标、三个坐标，以及游戏内复制的 X / Y / Z 文本。 */
export function parseMapLocation(value: string): (MapPoint & { y?: number }) | null {
  const input = value.trim().replace(/[，：]/g, char => char === '，' ? ',' : ':')
  const labelled = /x\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*[,;\s]*(?:y\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*[,;\s]*)?z\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i.exec(input)
  let x: number, z: number, y: number | undefined
  if (labelled) { x = Number(labelled[1]); z = Number(labelled[3]); if (labelled[2]) y = Number(labelled[2]) }
  else {
    if (!/^-?\d+(?:\.\d+)?(?:\s*[,;\s]\s*-?\d+(?:\.\d+)?){1,2}$/.test(input)) return null
    const parts = input.split(/[,;\s]+/).map(Number)
    x = parts[0]!; z = parts.at(-1)!; if (parts.length === 3) y = parts[1]
  }
  if (![x, z].every(number => Number.isFinite(number) && Math.abs(number) <= MAP_BLOCK_LIMIT)
    || (y !== undefined && (!Number.isFinite(y) || y < -4096 || y > 4095))) return null
  return { x, z, ...(y === undefined ? {} : { y }) }
}
