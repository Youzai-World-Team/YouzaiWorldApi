<script setup lang="ts">
import { ref } from 'vue'

definePageMeta({ layout: false })

const password = ref('')
const error = ref('')
const loading = ref(false)

const token = useCookie('youzai_token', { maxAge: 60 * 60 * 24 * 7 })

async function login() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: { password: password.value }
    })
    token.value = res.token
    await navigateTo('/')
  } catch (e: any) {
    error.value = e?.data?.statusMessage || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h1>YouzaiWorld 管理后台</h1>
      <md-outlined-text-field
        type="password"
        label="密码"
        :value="password"
        @input="password = ($event.target as HTMLInputElement).value"
        @keydown.enter="login"
      ></md-outlined-text-field>
      <p v-if="error" class="login-error">{{ error }}</p>
      <md-filled-button :disabled="loading" @click="login">
        {{ loading ? '登录中…' : '登录' }}
      </md-filled-button>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--md-sys-color-surface);
}

.login-card {
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 32px;
  border-radius: 16px;
  background: var(--md-sys-color-surface-container);
}

.login-card h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  text-align: center;
  color: var(--md-sys-color-on-surface);
}

.login-error {
  margin: -8px 0 0;
  font-size: 13px;
  color: #b3261e;
}
</style>
