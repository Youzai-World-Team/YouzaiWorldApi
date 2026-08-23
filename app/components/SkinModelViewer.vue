<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

type AnimationMode = 'idle' | 'walking' | 'running' | 'flying' | 'crouching' | 'attacking'

const props = withDefaults(defineProps<{
  skin?: string | null
  cape?: string | null
  slim?: boolean
  label?: string
  width?: number
  height?: number
}>(), {
  skin: null,
  cape: null,
  slim: false,
  label: '玩家模型预览',
  width: 260,
  height: 320,
})

const canvas = ref<HTMLCanvasElement | null>(null)
const failed = ref(false)
const loading = ref(false)
const autoRotate = ref(true)
const animationMode = ref<AnimationMode>('walking')
let viewer: import('skinview3d').SkinViewer | null = null
let skinviewModule: typeof import('skinview3d') | null = null
let updateToken = 0

function applyAnimation() {
  if (!viewer || !skinviewModule) return
  if (animationMode.value === 'idle') {
    viewer.animation = new skinviewModule.IdleAnimation()
    return
  }
  if (animationMode.value === 'walking') {
    viewer.animation = new skinviewModule.WalkingAnimation()
    return
  }
  if (animationMode.value === 'running') {
    viewer.animation = new skinviewModule.RunningAnimation()
    return
  }
  if (animationMode.value === 'flying') {
    viewer.animation = new skinviewModule.FlyingAnimation()
    return
  }
  if (animationMode.value === 'crouching') {
    const crouching = new skinviewModule.CrouchAnimation()
    crouching.runOnce = true
    crouching.showProgress = true
    viewer.animation = crouching
    return
  }
  viewer.animation = new skinviewModule.HitAnimation()
}

function onAutoRotateChange(event: Event) {
  autoRotate.value = Boolean((event.target as HTMLElement & { selected?: boolean }).selected)
}

function onAnimationChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'idle' || value === 'walking' || value === 'running'
    || value === 'flying' || value === 'crouching' || value === 'attacking') {
    animationMode.value = value
  }
}

async function updateViewer() {
  const element = canvas.value
  if (!element || !viewer) return
  const token = ++updateToken
  loading.value = true
  failed.value = false
  viewer.resetSkin()
  viewer.resetCape()

  try {
    if (props.skin) {
      await viewer.loadSkin(props.skin, { model: props.slim ? 'slim' : 'default' })
    }
    if (props.cape) await viewer.loadCape(props.cape)
    if (token !== updateToken) return
  } catch {
    if (token === updateToken) failed.value = true
  } finally {
    if (token === updateToken) loading.value = false
  }
}

onMounted(async () => {
  if (!canvas.value) return
  try {
    skinviewModule = await import('skinview3d')
    viewer = new skinviewModule.SkinViewer({
      canvas: canvas.value,
      width: props.width,
      height: props.height,
      pixelRatio: 'match-device',
      fov: 35,
      zoom: 0.82,
      enableControls: true,
    })
    viewer.controls.enablePan = false
    viewer.controls.enableZoom = true
    viewer.autoRotate = autoRotate.value
    viewer.autoRotateSpeed = 0.6
    applyAnimation()
    await updateViewer()
  } catch {
    failed.value = true
    loading.value = false
  }
})

watch(
  () => [props.skin, props.cape, props.slim, props.width, props.height],
  () => {
    if (!viewer) return
    viewer.setSize(props.width, props.height)
    void updateViewer()
  },
)

watch(autoRotate, (enabled) => {
  if (viewer) viewer.autoRotate = enabled
})

watch(animationMode, applyAnimation)

onBeforeUnmount(() => {
  updateToken += 1
  viewer?.dispose()
  viewer = null
  skinviewModule = null
})
</script>

<template>
  <div class="model-preview">
    <div
      class="model-viewer"
      :style="{
        '--model-width': `${width}px`,
        '--model-height': `${height}px`,
        '--model-aspect': `${width} / ${height}`,
      }"
      :title="label"
    >
      <canvas
        ref="canvas"
        class="model-canvas"
        :class="{ 'model-canvas--hidden': failed || loading || (!skin && !cape) }"
        :aria-label="label"
        role="img"
      ></canvas>
      <div v-if="loading" class="model-state" aria-hidden="true">
        <md-circular-progress indeterminate></md-circular-progress>
      </div>
      <div v-else-if="failed || (!skin && !cape)" class="model-state">
        <md-icon>{{ failed ? 'broken_image' : 'person_off' }}</md-icon>
      </div>
    </div>

    <div class="model-controls">
      <div class="control-row">
        <span class="control-label">自动旋转</span>
        <md-switch
          :selected="autoRotate"
          aria-label="自动旋转"
          @change="onAutoRotateChange"
        ></md-switch>
      </div>
      <div class="animation-select-wrap">
        <md-outlined-select class="animation-select" label="动作" @change="onAnimationChange">
          <md-select-option value="idle" :selected="animationMode === 'idle'">
            <div slot="headline">待机</div>
          </md-select-option>
          <md-select-option value="walking" :selected="animationMode === 'walking'">
            <div slot="headline">普通走路</div>
          </md-select-option>
          <md-select-option value="running" :selected="animationMode === 'running'">
            <div slot="headline">跑步</div>
          </md-select-option>
          <md-select-option value="flying" :selected="animationMode === 'flying'">
            <div slot="headline">飞行</div>
          </md-select-option>
          <md-select-option value="crouching" :selected="animationMode === 'crouching'">
            <div slot="headline">蹲下</div>
          </md-select-option>
          <md-select-option value="attacking" :selected="animationMode === 'attacking'">
            <div slot="headline">攻击</div>
          </md-select-option>
        </md-outlined-select>
      </div>
    </div>
  </div>
</template>

<style scoped>
.model-preview {
  display: flex;
  width: 100%;
  align-items: flex-start;
  justify-content: center;
  flex-wrap: wrap;
  gap: 16px;
  max-width: 100%;
}

.model-viewer {
  position: relative;
  width: min(var(--model-width), 100%);
  height: auto;
  aspect-ratio: var(--model-aspect);
  overflow: hidden;
  flex: 0 0 auto;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 12px;
  background:
    linear-gradient(var(--md-sys-color-surface-container-high), var(--md-sys-color-surface-container));
  touch-action: none;
}

.model-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}

.model-canvas:active { cursor: grabbing; }
.model-canvas--hidden { display: none; }

.model-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--md-sys-color-on-surface-variant);
}

.model-state md-icon { --md-icon-size: 28px; }

.model-controls {
  box-sizing: border-box;
  width: min(240px, 100%);
  min-width: 0;
  max-width: 100%;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 16px;
  padding: 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 8px;
  background: var(--md-sys-color-surface-container-high);
}

.control-row {
  min-width: 0;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.control-label {
  color: var(--md-sys-color-on-surface);
  font-size: 14px;
}

.animation-select {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-width: 0 !important;
  max-width: 100%;
  align-self: stretch;
}

.animation-select-wrap {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

@media (max-width: 620px) {
  .model-preview {
    flex-direction: column;
    align-items: center;
  }

  .model-controls {
    width: min(100%, 260px);
  }
}
</style>
