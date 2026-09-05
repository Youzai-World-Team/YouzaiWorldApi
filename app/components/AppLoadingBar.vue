<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { WEB_ASSET_BASE_URL } from '#shared/web-assets'

const { progress, isLoading, error } = useLoadingIndicator({
  duration: 900,
  throttle: 120,
  hideDelay: 240,
  resetDelay: 300,
})

const ROUTE_OVERLAY_DELAY = 260
const routeOverlayVisible = ref(false)
let overlayTimer: ReturnType<typeof setTimeout> | undefined

function clearOverlayTimer() {
  if (overlayTimer === undefined) return
  window.clearTimeout(overlayTimer)
  overlayTimer = undefined
}

watch(isLoading, (loading) => {
  clearOverlayTimer()

  if (loading) {
    overlayTimer = window.setTimeout(() => {
      if (isLoading.value) routeOverlayVisible.value = true
      overlayTimer = undefined
    }, ROUTE_OVERLAY_DELAY)
    return
  }

  routeOverlayVisible.value = false
})

onBeforeUnmount(() => clearOverlayTimer())
</script>

<template>
  <Transition name="route-loading">
    <div
      v-if="routeOverlayVisible"
      class="route-loading-overlay"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="正在加载页面"
    >
      <div class="route-loading-mark">
        <img :src="`${WEB_ASSET_BASE_URL}/images/uzw-tm.png`" alt="" />
        <md-circular-progress indeterminate></md-circular-progress>
      </div>
    </div>
  </Transition>
  <div
    class="loading-bar"
    :class="{ 'loading-bar--error': error }"
    :style="{ width: progress + '%', opacity: isLoading ? 1 : 0 }"
  ></div>
</template>

<style scoped>
.loading-bar {
  position: fixed;
  top: 0;
  left: 0;
  height: 3px;
  width: 0;
  z-index: 10000;
  background: var(--md-sys-color-primary);
  box-shadow: 0 0 8px var(--md-sys-color-primary);
  transition:
    width 0.15s ease,
    opacity 0.4s ease;
  opacity: 0;
  pointer-events: none;
}

.route-loading-overlay {
  position: fixed;
  inset: 0;
  z-index: 9998;
  display: grid;
  place-items: center;
  pointer-events: auto;
  cursor: progress;
  background: color-mix(in srgb, var(--md-sys-color-surface) 78%, transparent);
  backdrop-filter: blur(2px);
}

.route-loading-mark {
  display: grid;
  place-items: center;
  gap: 16px;
  min-width: min(196px, calc(100vw - 32px));
  min-height: 132px;
  padding: 20px;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 70%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--md-sys-color-surface-container) 92%, transparent);
  box-shadow: var(--md-sys-elevation-level2);
}

.route-loading-mark img {
  width: min(156px, calc(100vw - 72px));
  height: auto;
  display: block;
  opacity: 0.86;
  animation: route-loading-pulse 1.5s ease-in-out infinite;
}

.route-loading-mark md-circular-progress {
  --md-circular-progress-size: 28px;
  --md-circular-progress-active-indicator-color: var(--md-sys-color-primary);
}

.route-loading-enter-active,
.route-loading-leave-active {
  transition: opacity 180ms var(--md-sys-motion-easing-standard);
}

.route-loading-enter-from,
.route-loading-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .route-loading-mark img {
    animation: none;
  }

  .route-loading-enter-active,
  .route-loading-leave-active {
    transition-duration: 1ms;
  }
}

@keyframes route-loading-pulse {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.96);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.loading-bar--error {
  background: var(--md-sys-color-error);
  box-shadow: 0 0 8px var(--md-sys-color-error);
}
</style>
