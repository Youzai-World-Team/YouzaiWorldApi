<script setup lang="ts">
const props = withDefaults(defineProps<{ compact?: boolean; label?: string }>(), {
  compact: false,
  label: '',
})
</script>

<template>
  <div class="dashboard-permission-placeholder" :class="{ 'dashboard-permission-placeholder--compact': compact }" role="status">
    <div class="dashboard-permission-placeholder__image" aria-hidden="true">
      <md-icon>lock_person</md-icon>
    </div>
    <div class="dashboard-permission-placeholder__copy">
      <strong>{{ props.label ? `${props.label}：您无权查看该板块` : '您无权查看该板块' }}</strong>
      <small>请联系管理员申请访问权限</small>
    </div>
  </div>
</template>

<style scoped>
.dashboard-permission-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 132px;
  text-align: left;
}

.dashboard-permission-placeholder__image {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  flex: 0 0 auto;
  border-radius: 8px;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.dashboard-permission-placeholder__image md-icon {
  --md-icon-size: 28px;
}

.dashboard-permission-placeholder__copy {
  display: grid;
  gap: 6px;
}

.dashboard-permission-placeholder__copy strong {
  color: var(--md-sys-color-on-surface);
  font-size: 15px;
  font-weight: 500;
}

.dashboard-permission-placeholder__copy small {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}

.dashboard-permission-placeholder--compact {
  justify-content: flex-start;
  gap: 12px;
  min-height: 56px;
}

.dashboard-permission-placeholder--compact .dashboard-permission-placeholder__image {
  width: 44px;
  height: 44px;
  border-radius: 8px;
}

.dashboard-permission-placeholder--compact .dashboard-permission-placeholder__image md-icon {
  --md-icon-size: 22px;
}

.dashboard-permission-placeholder--compact .dashboard-permission-placeholder__copy small {
  display: none;
}

@media (max-width: 480px) {
  .dashboard-permission-placeholder {
    min-height: 112px;
  }
}
</style>
