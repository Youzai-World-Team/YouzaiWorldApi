/**
 * Minecraft 皮肤贴图的展开坐标表。
 *
 * 皮肤是把「头 / 身体 / 左右手臂 / 左右腿」六个长方体展开后拼进一张 64×64 图里，
 * 每个面的位置由原版模型固定。这里只列出画正面 / 背面 / 头像需要的那几个面：
 *
 * - 每个立方体的四个侧面在贴图里按「右、正、左、背」横向排列，所以
 *   背面的横坐标 = 正面横坐标 + 该面宽度 + 立方体深度（头是 8，其余是 4）。
 * - 纤细模型（Alex）的手臂宽 3px，因此手臂各面的横坐标会随宽度一起挪。
 * - 第二层（帽子 / 外套 / 袖子 / 裤腿）与基础层同形状，整体偏移到贴图的另一块区域。
 * - 64×32 的旧版皮肤只有右半身和帽子，左手臂 / 左腿要镜像右侧顶替。
 *
 * 目标坐标以皮肤像素为单位，正面 / 背面画布是 16×32（手臂 4 + 身体 8 + 手臂 4，
 * 头 8 + 身体 12 + 腿 12），头像画布是 8×8。
 */

export type SkinView = 'front' | 'back' | 'head'

/** [sx, sy, sw, sh] */
export type Rect = readonly [number, number, number, number]

export interface SkinPart {
  base: Rect
  overlay?: Rect
  /** 第二层是否也存在于 64×32 旧版布局（只有帽子满足） */
  overlayInLegacy?: boolean
  dx: number
  dy: number
  /** 旧版皮肤缺这一面时，镜像哪一面顶替 */
  legacyMirrorOf?: Rect
}

export const FIGURE_SIZE: Record<SkinView, { width: number; height: number }> = {
  front: { width: 16, height: 32 },
  back: { width: 16, height: 32 },
  head: { width: 8, height: 8 },
}

/** 披风贴图 64×32 里，穿在身上朝外的那一面。 */
export const CAPE_BACK_RECT: Rect = [1, 1, 10, 16]
export const CAPE_DEST = { dx: 3, dy: 8 }

export function armWidth(slim: boolean): number {
  return slim ? 3 : 4
}

export function skinParts(view: SkinView, slim: boolean): SkinPart[] {
  const aw = armWidth(slim)

  if (view === 'head') {
    return [{ base: [8, 8, 8, 8], overlay: [40, 8, 8, 8], overlayInLegacy: true, dx: 0, dy: 0 }]
  }

  if (view === 'back') {
    // 从背后看，玩家的右半身出现在观察者的右边。
    const rightArmBack: Rect = [44 + aw + 4, 20, aw, 12]
    return [
      { base: [12, 20, 4, 12], overlay: [12, 36, 4, 12], dx: 8, dy: 20 },
      { base: [28, 52, 4, 12], overlay: [12, 52, 4, 12], dx: 4, dy: 20, legacyMirrorOf: [12, 20, 4, 12] },
      { base: [32, 20, 8, 12], overlay: [32, 36, 8, 12], dx: 4, dy: 8 },
      { base: rightArmBack, overlay: [44 + aw + 4, 36, aw, 12], dx: 12, dy: 8 },
      {
        base: [36 + aw + 4, 52, aw, 12],
        overlay: [52 + aw + 4, 52, aw, 12],
        dx: 4 - aw,
        dy: 8,
        legacyMirrorOf: rightArmBack,
      },
      { base: [24, 8, 8, 8], overlay: [56, 8, 8, 8], overlayInLegacy: true, dx: 4, dy: 0 },
    ]
  }

  const rightArmFront: Rect = [44, 20, aw, 12]
  return [
    { base: [4, 20, 4, 12], overlay: [4, 36, 4, 12], dx: 4, dy: 20 },
    { base: [20, 52, 4, 12], overlay: [4, 52, 4, 12], dx: 8, dy: 20, legacyMirrorOf: [4, 20, 4, 12] },
    { base: [20, 20, 8, 12], overlay: [20, 36, 8, 12], dx: 4, dy: 8 },
    { base: rightArmFront, overlay: [44, 36, aw, 12], dx: 4 - aw, dy: 8 },
    { base: [36, 52, aw, 12], overlay: [52, 52, aw, 12], dx: 12, dy: 8, legacyMirrorOf: rightArmFront },
    { base: [8, 8, 8, 8], overlay: [40, 8, 8, 8], overlayInLegacy: true, dx: 4, dy: 0 },
  ]
}
