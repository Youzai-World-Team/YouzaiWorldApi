<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted } from 'vue'

definePageMeta({ layout: false })

useHead({ title: '登录' })

const password = ref('')
const username = ref('')
const turnstileToken = ref('')
const loading = ref(false)
const dark = ref(false)
const turnstileContainer = ref<HTMLElement | null>(null)
const turnstileWidgetId = ref<string | number | null>(null)
const turnstileSiteKey = ref('')
const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const { remember } = useEntry()
remember(String(route.params.entry || ''))

const { showToast } = useToast()

function loadTurnstile(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()

  const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile-script]')
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Turnstile 脚本加载失败')), { once: true })
    })
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.turnstileScript = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Turnstile 脚本加载失败'))
    document.head.appendChild(script)
  })
}

function renderTurnstile() {
  if (!turnstileContainer.value || !window.turnstile || turnstileWidgetId.value !== null) return
  turnstileWidgetId.value = window.turnstile.render(turnstileContainer.value, {
    sitekey: turnstileSiteKey.value || runtimeConfig.public.turnstileSiteKey,
    action: 'login',
    size: window.innerWidth <= 360 ? 'compact' : 'flexible',
    callback: (token) => { turnstileToken.value = token },
    'error-callback': () => { turnstileToken.value = '' },
    'expired-callback': () => { turnstileToken.value = '' },
  })
}

function resetTurnstile() {
  turnstileToken.value = ''
  if (turnstileWidgetId.value !== null) window.turnstile?.reset(turnstileWidgetId.value)
}

function applyTheme(isDark: boolean) {
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
  localStorage.setItem('theme', isDark ? 'dark' : 'light')
}

function toggleTheme() {
  dark.value = !dark.value
  applyTheme(dark.value)
}

onMounted(async () => {
  dark.value = localStorage.getItem('theme') === 'dark'
  applyTheme(dark.value)
  try {
    const config = await $fetch<{ siteKey?: string }>('/api/auth/turnstile')
    turnstileSiteKey.value = config.siteKey || String(runtimeConfig.public.turnstileSiteKey || '')
    await loadTurnstile()
    renderTurnstile()
  } catch {
    showToast('人机验证加载失败，请检查网络后重试', 'error')
  }
})

async function login() {
  if (loading.value) return
  if (!turnstileToken.value) {
    showToast('请先完成人机验证', 'error')
    return
  }
  loading.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: {
        username: username.value,
        password: password.value,
        entry: String(route.params.entry || ''),
        turnstileToken: turnstileToken.value,
      }
    })
    await navigateTo('/')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '登录失败', 'error')
    resetTurnstile()
  } finally {
    loading.value = false
  }
}

onBeforeUnmount(() => {
  if (turnstileWidgetId.value !== null) window.turnstile?.remove?.(turnstileWidgetId.value)
})
</script>

<template>
  <div class="login-page">
    <div class="theme-toggle">
      <md-icon-button :aria-label="dark ? '切换浅色' : '切换深色'" @click="toggleTheme">
        <md-icon>{{ dark ? 'light_mode' : 'dark_mode' }}</md-icon>
      </md-icon-button>
    </div>

    <main class="login-content">
      <img class="brand-logo" src="/images/uzw-tm.png" alt="悠哉世界" />

      <div class="login-card">
        <md-outlined-text-field
          label="用户名"
          autocomplete="username"
          :value="username"
          @input="username = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
        <md-outlined-text-field
          type="password"
          label="密码"
          autocomplete="current-password"
          :value="password"
          @input="password = ($event.target as HTMLInputElement).value"
          @keydown.enter="login"
        ></md-outlined-text-field>
        <div ref="turnstileContainer" class="turnstile-container" aria-label="人机验证"></div>
        <md-filled-button :disabled="loading || !turnstileToken" @click="login">
          {{ loading ? '登录中…' : '登录' }}
        </md-filled-button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 72px 16px 24px;
  background: var(--md-sys-color-surface);
}

.theme-toggle {
  position: fixed;
  top: 16px;
  right: 16px;
}

.login-content {
  width: min(380px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 20px;
}

.brand-logo {
  display: block;
  width: 100%;
  height: auto;
  max-height: 120px;
  object-fit: contain;
}

.login-card {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 32px;
  border-radius: 8px;
  background: var(--md-sys-color-surface-container);
}

.turnstile-container {
  min-height: 65px;
  display: flex;
  justify-content: center;
  overflow: hidden;
}

@media (max-width: 480px) {
  .theme-toggle {
    top: 8px;
    right: 8px;
  }

  .login-card {
    padding: 24px 20px;
  }

  .login-content {
    gap: 16px;
  }

  .brand-logo {
    max-height: 92px;
  }
}
</style>
