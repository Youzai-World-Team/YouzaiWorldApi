<script setup lang="ts">
import { ref } from 'vue'

useHead({ title: '账户' })

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const updating = ref(false)

const token = useCookie('youzai_token')
const { showToast } = useToast()

function onInput(field: 'old' | 'new' | 'confirm', e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (field === 'old') oldPassword.value = v
  else if (field === 'new') newPassword.value = v
  else confirmPassword.value = v
}

async function updatePassword() {
  if (updating.value) return
  if (!newPassword.value || newPassword.value !== confirmPassword.value) {
    showToast('两次输入的新密码不一致', 'error')
    return
  }
  updating.value = true
  try {
    await $fetch('/api/auth/password', {
      method: 'POST',
      body: { oldPassword: oldPassword.value, newPassword: newPassword.value }
    })
    showToast('密码已更新')
    oldPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '更新失败', 'error')
  } finally {
    updating.value = false
  }
}

async function logout() {
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
  } finally {
    token.value = null
    await navigateTo('/login')
  }
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">账户</h1>

    <div class="card" style="max-width: 480px">
      <h2 class="card-title">更新密码</h2>
      <div class="form">
        <md-outlined-text-field
          type="password"
          label="当前密码"
          :value="oldPassword"
          @input="onInput('old', $event)"
        ></md-outlined-text-field>
        <md-outlined-text-field
          type="password"
          label="新密码"
          :value="newPassword"
          @input="onInput('new', $event)"
        ></md-outlined-text-field>
        <md-outlined-text-field
          type="password"
          label="确认新密码"
          :value="confirmPassword"
          @input="onInput('confirm', $event)"
        ></md-outlined-text-field>
        <md-filled-button :disabled="updating" @click="updatePassword">
          {{ updating ? '更新中…' : '更新密码' }}
        </md-filled-button>
      </div>
    </div>

    <div class="card" style="max-width: 480px; margin-top: 20px">
      <h2 class="card-title">账户操作</h2>
      <md-text-button class="logout-btn" @click="logout">
        <md-icon slot="icon">logout</md-icon>
        登出账户
      </md-text-button>
    </div>
  </div>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.logout-btn {
  color: var(--md-sys-color-error);
}
</style>
