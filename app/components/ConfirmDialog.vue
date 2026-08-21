<script setup lang="ts">
import { onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  message: string
  icon?: string
  confirmLabel?: string
  pendingLabel?: string
  cancelLabel?: string
  destructive?: boolean
  pending?: boolean
}>(), {
  icon: 'help',
  confirmLabel: '确认',
  pendingLabel: '处理中…',
  cancelLabel: '取消',
  destructive: false,
  pending: false,
})

const emit = defineEmits<{
  confirm: []
  cancel: []
  closed: []
}>()

const dialog = ref<HTMLElement | null>(null)
const { apply: applyDialogAnimation } = useDialogAnimation()

function cancel() {
  if (!props.pending) emit('cancel')
}

function onCancel(event: Event) {
  if (props.pending) {
    event.preventDefault()
    return
  }
  emit('cancel')
}

onMounted(() => applyDialogAnimation(dialog.value))
</script>

<template>
  <md-dialog
    ref="dialog"
    :open="open"
    :aria-busy="pending ? 'true' : 'false'"
    @cancel="onCancel"
    @closed="emit('closed')"
  >
    <md-icon slot="icon" class="dialog-icon" :class="{ 'dialog-icon--destructive': destructive }">
      {{ icon }}
    </md-icon>
    <div slot="headline">{{ title }}</div>
    <div slot="content" class="confirm-content">
      <p>{{ message }}</p>
      <slot />
    </div>
    <div slot="actions" class="confirm-actions">
      <md-text-button :disabled="pending" @click="cancel">{{ cancelLabel }}</md-text-button>
      <md-text-button
        :class="{ 'confirm-button--destructive': destructive }"
        :disabled="pending"
        @click="emit('confirm')"
      >
        {{ pending ? pendingLabel : confirmLabel }}
      </md-text-button>
    </div>
  </md-dialog>
</template>

<style scoped>
.dialog-icon {
  color: var(--md-sys-color-primary);
  font-variation-settings: 'FILL' 1;
}

.dialog-icon--destructive,
.confirm-button--destructive {
  color: var(--md-sys-color-error);
}

.confirm-content {
  min-width: min(360px, calc(100vw - 72px));
}

.confirm-content p {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.confirm-content :deep(> * + *) {
  margin-top: 16px;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
