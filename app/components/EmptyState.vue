<script setup lang="ts">
import { computed } from 'vue'
import { webAssetUrl } from '#shared/web-assets'

const DEFAULT_EMPTY_STATE_IMAGE = 'https://assets.mcyzw.top/images/empty-looking-for-answers.svg'

const props = withDefaults(defineProps<{
  illustrated?: boolean
  image?: string
}>(), {
  illustrated: true,
  image: 'https://assets.mcyzw.top/images/empty-looking-for-answers.svg',
})
const resolvedImage = computed(() => webAssetUrl(props.image || DEFAULT_EMPTY_STATE_IMAGE))
</script>

<template>
  <div
    class="empty-state"
    :class="{ 'empty-state--compact': !props.illustrated }"
    role="status"
  >
    <img
      v-if="props.illustrated"
      class="empty-state__image"
      :src="resolvedImage"
      alt=""
      aria-hidden="true"
    />
    <strong v-if="$slots.title" class="empty-state__title"><slot name="title" /></strong>
    <p class="empty-state__text"><slot /></p>
  </div>
</template>

<style scoped>
.empty-state {
  width: 100%;
  min-height: 246px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 28px 20px 32px;
  text-align: center;
}

.empty-state--compact {
  min-height: 120px;
}

.empty-state__image {
  width: min(220px, 68vw);
  height: 160px;
  display: block;
  box-sizing: border-box;
  object-fit: contain;
}

.empty-state__title {
  margin: 0;
  color: var(--md-sys-color-on-surface);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}

.empty-state__text {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
  line-height: 1.6;
}

:global(:root[data-theme='dark']) .empty-state__image {
  padding: 6px;
  border-radius: 8px;
  background: #f7faf4;
}

@media (max-width: 640px) {
  .empty-state {
    min-height: 220px;
    padding: 24px 16px 28px;
  }

  .empty-state--compact {
    min-height: 104px;
  }

  .empty-state__image {
    width: min(188px, 64vw);
    height: 140px;
  }
}
</style>
