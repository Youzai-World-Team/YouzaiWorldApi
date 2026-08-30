<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useToast } from '~/composables/useToast'

const { toasts } = useToast()
type ToastLayerElement = HTMLDivElement & {
  showPopover?: () => void
  hidePopover?: () => void
}

const toastLayer = ref<ToastLayerElement | null>(null)
let dialogObserver: MutationObserver | null = null
let reorderFrame = 0

function hasOpenDialog() {
  return typeof document !== 'undefined' && Boolean(document.querySelector('md-dialog[open]'))
}

function isPopoverOpen(layer: ToastLayerElement) {
  try {
    return layer.matches(':popover-open')
  } catch {
    return false
  }
}

function syncToastLayer(bringToFront = false) {
  void nextTick(() => {
    const layer = toastLayer.value
    if (!layer || typeof layer.showPopover !== 'function' || typeof layer.hidePopover !== 'function') return

    const open = isPopoverOpen(layer)
    if (toasts.value.length === 0) {
      if (open) layer.hidePopover?.()
      return
    }

    if (bringToFront && open) layer.hidePopover?.()
    if (!isPopoverOpen(layer)) layer.showPopover?.()
  })
}

watch(
  () => toasts.value.length,
  () => syncToastLayer(hasOpenDialog()),
  { immediate: true },
)

onMounted(() => {
  syncToastLayer()
  if (typeof MutationObserver === 'undefined') return
  dialogObserver = new MutationObserver(() => {
    if (!toasts.value.length || reorderFrame) return
    reorderFrame = window.requestAnimationFrame(() => {
      reorderFrame = 0
      syncToastLayer(true)
    })
  })
  dialogObserver.observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true })
})

onBeforeUnmount(() => {
  dialogObserver?.disconnect()
  if (reorderFrame) window.cancelAnimationFrame(reorderFrame)
  const layer = toastLayer.value
  if (layer && typeof layer.hidePopover === 'function' && isPopoverOpen(layer)) layer.hidePopover()
})
</script>

<template>
  <div ref="toastLayer" class="toast-container" popover="manual">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast--${t.type}`">
        <md-icon class="toast-icon">{{ t.type === 'error' ? 'error' : 'info' }}</md-icon>
        <span>{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-container {
  position: fixed;
  inset: auto;
  top: calc(var(--app-bar-height) + 12px);
  left: 50%;
  right: auto;
  bottom: auto;
  width: min(520px, calc(100vw - 24px));
  margin: 0;
  padding: 0;
  border: 0;
  overflow: visible;
  transform: translateX(-50%);
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  background: transparent;
  color: inherit;
}

.toast-container:not(:popover-open) {
  display: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 14px 16px;
  border-radius: var(--md-sys-shape-corner-extra-small);
  font-family: var(--md-sys-typescale-body-medium-font);
  font-size: var(--md-sys-typescale-body-medium-size);
  line-height: var(--md-sys-typescale-body-medium-line-height);
  background: var(--md-sys-color-inverse-surface);
  color: var(--md-sys-color-inverse-on-surface);
  box-shadow: var(--md-sys-elevation-level3);
  overflow-wrap: anywhere;
}

.toast-icon {
  --md-icon-size: 18px;
  font-variation-settings: 'FILL' 1;
  flex-shrink: 0;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-medium1) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-medium1) var(--md-sys-motion-easing-standard);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
</style>
