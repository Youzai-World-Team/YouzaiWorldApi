<script setup lang="ts">
import { onMounted } from 'vue'

const router = useRouter()

const NAV_DELAY = 800

const { progress, isLoading, error, finish } = useLoadingIndicator({
  duration: NAV_DELAY,
  throttle: 0,
  hideDelay: 700,
  resetDelay: 400,
})

onMounted(() => {
  router.beforeEach(async () => {
    await new Promise((r) => setTimeout(r, NAV_DELAY))
    finish()
  })
})
</script>

<template>
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

.loading-bar--error {
  background: var(--md-sys-color-error);
  box-shadow: 0 0 8px var(--md-sys-color-error);
}
</style>
