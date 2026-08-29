<script setup lang="ts">
import { useToast } from '~/composables/useToast'

const { toasts } = useToast()
</script>

<template>
  <div class="toast-container">
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
  top: calc(var(--app-bar-height) + 12px);
  left: 50%;
  width: min(520px, calc(100vw - 24px));
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
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
