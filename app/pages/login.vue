<script setup lang="ts">
import { ref, onMounted } from 'vue'

definePageMeta({ layout: false })

useHead({ title: '登录' })

const password = ref('')
const loading = ref(false)
const dark = ref(false)

const token = useCookie('youzai_token', { maxAge: 60 * 60 * 24 * 7 })

const { showToast } = useToast()

function applyTheme(isDark: boolean) {
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
  localStorage.setItem('theme', isDark ? 'dark' : 'light')
}

function toggleTheme() {
  dark.value = !dark.value
  applyTheme(dark.value)
}

onMounted(() => {
  dark.value = localStorage.getItem('theme') === 'dark'
  applyTheme(dark.value)
})

async function login() {
  if (loading.value) return
  loading.value = true
  try {
    const res = await $fetch<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: { password: password.value }
    })
    token.value = res.token
    await navigateTo('/')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '登录失败', 'error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="theme-toggle">
      <md-icon-button :aria-label="dark ? '切换浅色' : '切换深色'" @click="toggleTheme">
        <md-icon>{{ dark ? 'light_mode' : 'dark_mode' }}</md-icon>
      </md-icon-button>
    </div>

    <div class="login-card">
      <md-outlined-text-field
        type="password"
        label="密码"
        :value="password"
        @input="password = ($event.target as HTMLInputElement).value"
        @keydown.enter="login"
      ></md-outlined-text-field>
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

.theme-toggle {
  position: fixed;
  top: 16px;
  right: 16px;
}

.login-card {
  width: min(320px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 32px;
  border-radius: 16px;
  background: var(--md-sys-color-surface-container);
}
</style>
