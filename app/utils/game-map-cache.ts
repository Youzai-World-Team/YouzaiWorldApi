import { mapRectangleContains, uncoveredMapRectangles, type MapRectangle } from '#shared/game-map-view'

const MAX_CACHED_TILES = 4096
const MAX_COVERED_RECTANGLES = 48

export interface CachedMapTile {
  namespace: string; x: number; z: number; bytes: Uint8Array
  images: Map<string, HTMLCanvasElement>
}

/** 缓存像素及完整读取过的空白范围；淘汰瓦片时撤销相应范围的完整标记。 */
export class GameMapTileCache {
  private tiles = new Map<string, CachedMapTile>()
  private covered = new Map<string, MapRectangle[]>()

  private key(namespace: string, x: number, z: number) { return `${namespace}|${x}|${z}` }

  put(namespace: string, x: number, z: number, bytes: Uint8Array): void {
    const key = this.key(namespace, x, z)
    this.tiles.delete(key)
    this.tiles.set(key, { namespace, x, z, bytes, images: new Map() })
    while (this.tiles.size > MAX_CACHED_TILES) {
      const oldest = this.tiles.keys().next().value!
      const tile = this.tiles.get(oldest)!
      this.tiles.delete(oldest)
      this.covered.set(tile.namespace, (this.covered.get(tile.namespace) || [])
        .filter(rect => !mapRectangleContains(rect, tile.x, tile.z)))
    }
  }

  get(namespace: string, x: number, z: number): CachedMapTile | undefined {
    return this.tiles.get(this.key(namespace, x, z))
  }

  visible(namespace: string, view: MapRectangle): CachedMapTile[] {
    const values: CachedMapTile[] = []
    for (const tile of this.tiles.values()) {
      if (tile.namespace !== namespace || !mapRectangleContains(view, tile.x, tile.z)) continue
      values.push(tile)
    }
    for (const tile of values) {
      const key = this.key(namespace, tile.x, tile.z)
      this.tiles.delete(key); this.tiles.set(key, tile)
    }
    return values
  }

  missing(namespace: string, view: MapRectangle): MapRectangle[] {
    return uncoveredMapRectangles(view, this.covered.get(namespace) || [])
  }

  complete(namespace: string, view: MapRectangle): void {
    const existing = (this.covered.get(namespace) || []).filter(rect => !(
      rect.minX >= view.minX && rect.maxX <= view.maxX && rect.minZ >= view.minZ && rect.maxZ <= view.maxZ
    ))
    this.covered.set(namespace, [...existing, view].slice(-MAX_COVERED_RECTANGLES))
  }

  invalidate(worldId: string, removePixels = false): void {
    for (const key of this.covered.keys()) if (key.startsWith(worldId + '|')) this.covered.delete(key)
    if (removePixels) for (const [key, tile] of this.tiles) if (tile.namespace.startsWith(worldId + '|')) this.tiles.delete(key)
  }

  clear(): void { this.tiles.clear(); this.covered.clear() }
}

/** 光照变化只重新生成浏览器位图，不请求相同的服务端瓦片。 */
export function mapTileCanvas(tile: CachedMapTile, lighting: boolean, nether: boolean): HTMLCanvasElement {
  const key = `${lighting}|${nether}`
  const existing = tile.images.get(key)
  if (existing) return existing
  const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(16, 16), data = new DataView(tile.bytes.buffer, tile.bytes.byteOffset, tile.bytes.byteLength)
  for (let i = 0; i < 256; i++) {
    const elevation = data.getInt16(1024 + i * 2)
    const west = i % 16 ? data.getInt16(1024 + (i - 1) * 2) : elevation
    const north = i >= 16 ? data.getInt16(1024 + (i - 16) * 2) : elevation
    let shade = 0.93 + Math.max(-6, Math.min(6, (west === -32768 ? elevation : west) + (north === -32768 ? elevation : north) - 2 * elevation)) * 0.022
    if (lighting) {
      const light = tile.bytes[1536 + i]!, brightness = Math.max(light & 15, light >>> 4), ambient = nether ? 0.48 : 0.25
      shade *= Math.min(1, ambient + brightness / 15 * (1 - ambient) + 0.15)
    }
    for (let channel = 0; channel < 3; channel++) image.data[i * 4 + channel] = Math.min(255, Math.floor(tile.bytes[i * 4 + channel]! * shade))
    image.data[i * 4 + 3] = tile.bytes[i * 4 + 3]!
  }
  ctx.putImageData(image, 0, 0); tile.images.set(key, canvas)
  return canvas
}
