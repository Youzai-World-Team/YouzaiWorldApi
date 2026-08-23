<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { CAPE_BACK_RECT, CAPE_DEST, FIGURE_SIZE, skinParts, type Rect, type SkinView } from '../utils/skin-layout'

// 把皮肤贴图里需要的几个面按整数倍放大画到 canvas 上，关掉插值保持像素风。
// 坐标表在 app/utils/skin-layout.ts，这里只负责加载图片和落笔顺序。

const props = withDefaults(defineProps<{
  skin?: string | null
  cape?: string | null
  slim?: boolean
  view?: SkinView
  pixelSize?: number
  label?: string
}>(), {
  skin: null,
  cape: null,
  slim: false,
  view: 'front',
  pixelSize: 6,
  label: '',
})

const canvas = ref<HTMLCanvasElement | null>(null)
const failed = ref(false)
const imageCache = new Map<string, Promise<HTMLImageElement>>()
let renderToken = 0

const cssWidth = computed(() => FIGURE_SIZE[props.view].width * props.pixelSize)
const cssHeight = computed(() => FIGURE_SIZE[props.view].height * props.pixelSize)
// 只上传了披风的账户没有皮肤可画，但背面视角仍然应该把披风显示出来。
const capeVisible = computed(() => Boolean(props.cape) && props.view === 'back')
const hasContent = computed(() => Boolean(props.skin) || capeVisible.value)

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src)
  if (cached) return cached
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`无法加载 ${src}`))
    image.src = src
  })
  // 失败结果不留在缓存里，刷新后可以重试。
  pending.catch(() => imageCache.delete(src))
  imageCache.set(src, pending)
  return pending
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  rect: Rect,
  dx: number,
  dy: number,
  scale: number,
  mirrored: boolean,
) {
  const [sx, sy, sw, sh] = rect
  if (mirrored) {
    ctx.save()
    ctx.translate(dx + sw, dy)
    ctx.scale(-1, 1)
    ctx.drawImage(image, sx * scale, sy * scale, sw * scale, sh * scale, 0, 0, sw, sh)
    ctx.restore()
    return
  }
  ctx.drawImage(image, sx * scale, sy * scale, sw * scale, sh * scale, dx, dy, sw, sh)
}

async function render() {
  const element = canvas.value
  if (!element || !hasContent.value) return
  const token = ++renderToken

  let skinImage: HTMLImageElement | null = null
  let capeImage: HTMLImageElement | null = null
  try {
    if (props.skin) skinImage = await loadImage(props.skin)
    if (capeVisible.value) capeImage = await loadImage(props.cape!).catch(() => null)
  } catch {
    if (token === renderToken) failed.value = true
    return
  }
  if (token !== renderToken || !canvas.value) return
  if (!skinImage && !capeImage) {
    failed.value = true
    return
  }
  failed.value = false

  const ratio = typeof window === 'undefined'
    ? 1
    : Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 1)))
  const zoom = props.pixelSize * ratio
  // 改写 width / height 会重置画布状态，因此必须先定尺寸再取上下文。
  element.width = FIGURE_SIZE[props.view].width * zoom
  element.height = FIGURE_SIZE[props.view].height * zoom
  const ctx = element.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  ctx.setTransform(zoom, 0, 0, zoom, 0, 0)

  if (skinImage) {
    // HD 皮肤等比放大，取样坐标按 64 宽的标准布局折算。
    const width = skinImage.naturalWidth || 64
    const height = skinImage.naturalHeight || 64
    const scale = width / 64
    const legacy = height / width <= 0.5

    const parts = skinParts(props.view, props.slim)
    for (const part of parts) {
      if (legacy && part.legacyMirrorOf) {
        drawRect(ctx, skinImage, part.legacyMirrorOf, part.dx, part.dy, scale, true)
        continue
      }
      drawRect(ctx, skinImage, part.base, part.dx, part.dy, scale, false)
    }
    // 第二层统一压在所有基础层之后，否则相邻部件会盖住袖口和裤脚。
    for (const part of parts) {
      if (!part.overlay) continue
      // 旧版皮肤只有帽子这一层，其余第二层区域在 64×32 里根本不存在。
      if (legacy && !part.overlayInLegacy) continue
      drawRect(ctx, skinImage, part.overlay, part.dx, part.dy, scale, false)
    }
  }

  // 背面视角里披风挡在身体之前，最后画。
  if (capeImage) {
    drawRect(ctx, capeImage, CAPE_BACK_RECT, CAPE_DEST.dx, CAPE_DEST.dy,
      (capeImage.naturalWidth || 64) / 64, false)
  }
}

watch(
  () => [props.skin, props.cape, props.slim, props.view, props.pixelSize],
  () => {
    renderToken += 1
    // 换图后重新给一次机会：上一张图加载失败不该让新的一张也显示成损坏。
    failed.value = false
    render()
  },
)

onMounted(render)
</script>

<template>
  <div class="figure" :style="{ width: `${cssWidth}px`, height: `${cssHeight}px` }" :title="label || undefined">
    <!-- canvas 常驻 DOM（隐藏时也能正常绘制），避免占位图与画布来回切换时取不到引用。 -->
    <canvas
      ref="canvas"
      class="figure-canvas"
      :class="{ 'figure-canvas--hidden': !hasContent || failed }"
      :style="{ width: `${cssWidth}px`, height: `${cssHeight}px` }"
      :aria-label="label || undefined"
      role="img"
    ></canvas>
    <div v-if="!hasContent || failed" class="figure-empty">
      <md-icon>{{ failed ? 'broken_image' : 'person_off' }}</md-icon>
    </div>
  </div>
</template>

<style scoped>
.figure {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.figure-canvas {
  display: block;
  image-rendering: pixelated;
}

.figure-canvas--hidden {
  display: none;
}

.figure-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--md-sys-color-outline-variant);
  border-radius: 8px;
  color: var(--md-sys-color-on-surface-variant);
}

.figure-empty md-icon {
  --md-icon-size: 20px;
}
</style>
