<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  open: boolean
  forced?: boolean
}>(), {
  forced: false,
})

const emit = defineEmits<{
  close: []
  updated: []
}>()

const dialog = ref<HTMLElement | null>(null)
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const updating = ref(false)
const { showToast } = useToast()
const { load: loadEntry } = useEntry()
const access = useAdminAccess()
const { apply: applyDialogAnimation } = useDialogAnimation()
const { policy: passwordPolicy, load: loadPasswordPolicy, validate: validatePasswordPolicy } = usePasswordPolicy()

onMounted(() => {
  void loadPasswordPolicy()
  applyDialogAnimation(dialog.value)
})

watch(() => props.open, async (open) => {
  if (!open) return
  resetForm()
  await nextTick()
  applyDialogAnimation(dialog.value)
})

function resetForm() {
  oldPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
}

function requestClose() {
  if (!props.forced && !updating.value) emit('close')
}

function onCancel(event: Event) {
  if (props.forced || updating.value) event.preventDefault()
  else emit('close')
}

function onClosed() {
  resetForm()
  if (props.open && !props.forced) emit('close')
}

async function updatePassword() {
  if (updating.value) return
  const passwordLength = Array.from(newPassword.value).length
  if (passwordLength < 12 || passwordLength > 128) {
    showToast('新密码需要为 12 至 128 位', 'error')
    return
  }
  if (newPassword.value === oldPassword.value) {
    showToast('新密码不能与当前密码相同', 'error')
    return
  }
  const passwordPolicyError = validatePasswordPolicy(newPassword.value, 12, '新密码')
  if (passwordPolicyError) {
    showToast(passwordPolicyError, 'error')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    showToast('两次输入的新密码不一致', 'error')
    return
  }

  updating.value = true
  try {
    const entry = await loadEntry()
    await $fetch('/api/auth/password', {
      method: 'POST',
      body: { oldPassword: oldPassword.value, newPassword: newPassword.value },
    })
    emit('updated')
    emit('close')
    access.clear()
    await navigateTo('/' + entry)
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '密码更新失败', 'error')
  } finally {
    updating.value = false
  }
}
</script>

<template>
  <md-dialog
    ref="dialog"
    :open="open"
    :aria-busy="updating ? 'true' : 'false'"
    @cancel="onCancel"
    @closed="onClosed"
  >
    <md-icon slot="icon">lock_reset</md-icon>
    <div slot="headline">{{ forced ? '更新过期密码' : '更新密码' }}</div>
    <div slot="content" class="admin-password-dialog-form">
      <md-outlined-text-field
        type="password"
        label="当前密码"
        autocomplete="current-password"
        :value="oldPassword"
        @input="oldPassword = ($event.target as HTMLInputElement).value"
      ></md-outlined-text-field>
      <md-outlined-text-field
        type="password"
        label="新密码"
        supporting-text="不能与当前密码或最近 3 次密码相同"
        autocomplete="new-password"
        :value="newPassword"
        @input="newPassword = ($event.target as HTMLInputElement).value"
      ></md-outlined-text-field>
      <PasswordStrength
        :password="newPassword"
        :min-length="12"
        :required-score="passwordPolicy.enabled ? passwordPolicy.minimumScore : 0"
      />
      <md-outlined-text-field
        type="password"
        label="确认新密码"
        autocomplete="new-password"
        :value="confirmPassword"
        @input="confirmPassword = ($event.target as HTMLInputElement).value"
        @keydown.enter="updatePassword"
      ></md-outlined-text-field>
    </div>
    <div slot="actions">
      <md-text-button v-if="!forced" :disabled="updating" @click="requestClose">取消</md-text-button>
      <md-filled-button :disabled="updating" @click="updatePassword">
        {{ updating ? '更新中…' : '更新密码' }}
      </md-filled-button>
    </div>
  </md-dialog>
</template>

<style scoped>
.admin-password-dialog-form {
  width: min(360px, calc(100vw - 72px));
  min-width: 0;
  display: grid;
  gap: 16px;
}

.admin-password-dialog-form md-outlined-text-field {
  width: 100%;
}

@media (max-width: 640px) {
  .admin-password-dialog-form {
    width: 100%;
  }
}
</style>
