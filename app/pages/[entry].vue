<script setup lang="ts">
import { computed, ref, onBeforeUnmount, onMounted } from 'vue'
import type { ThemeMode } from '../composables/useThemeTransition'
import { clientDeviceIcon } from '#shared/client-device'

definePageMeta({ layout: false })

useHead({ title: '登录' })

const password = ref('')
const username = ref('')
const turnstileToken = ref('')
const loading = ref(false)
const dark = ref(false)
const themeMode = ref<ThemeMode>('system')
const { toggleTheme, themeIcon, themeModeLabel, themeButtonLabel } = useThemeTransition(dark, themeMode)
const turnstileContainer = ref<HTMLElement | null>(null)
const turnstileWidgetId = ref<string | number | null>(null)
const turnstileSiteKey = ref('')
interface OnlineSession {
  createdAt: number
  lastSeenAt: number
  ip: string
  browser: string
  os: string
  device: string
  location: string
}
interface TakeoverPrompt {
  takeoverToken: string
  expiresAt: number
  sessionCount: number
  session: OnlineSession | null
}
const takeoverPrompt = ref<TakeoverPrompt | null>(null)
const takeoverPending = ref(false)
const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const { remember } = useEntry()
remember(String(route.params.entry || ''))

const { showToast } = useToast()
const takeoverMessage = computed(() => {
  const count = takeoverPrompt.value?.sessionCount || 0
  return count > 1
    ? `当前账户有 ${count} 个在线会话，继续登录将退出全部旧设备。`
    : '当前账户已在其他设备在线，继续登录将退出旧设备。'
})
const takeoverDeviceIcon = computed(() => clientDeviceIcon(takeoverPrompt.value?.session))

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

onMounted(async () => {
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
    const conflict = e?.data?.data
    if (conflict?.code === 'ADMIN_ACCOUNT_ONLINE' && typeof conflict.takeoverToken === 'string') {
      takeoverPrompt.value = {
        takeoverToken: conflict.takeoverToken,
        expiresAt: Number(conflict.expiresAt || 0),
        sessionCount: Math.max(1, Number(conflict.sessionCount || 1)),
        session: conflict.session || null,
      }
      resetTurnstile()
      return
    }
    showToast(e?.data?.statusMessage || '登录失败', 'error')
    resetTurnstile()
  } finally {
    loading.value = false
  }
}

async function confirmTakeover() {
  if (!takeoverPrompt.value || takeoverPending.value) return
  takeoverPending.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: {
        entry: String(route.params.entry || ''),
        takeoverToken: takeoverPrompt.value.takeoverToken,
      },
    })
    takeoverPrompt.value = null
    await navigateTo('/')
  } catch (error: any) {
    takeoverPrompt.value = null
    showToast(error?.data?.statusMessage || '挤下线登录失败，请重新登录', 'error')
    resetTurnstile()
  } finally {
    takeoverPending.value = false
  }
}

function cancelTakeover() {
  if (!takeoverPending.value) takeoverPrompt.value = null
}

function formatClient(session: OnlineSession | null) {
  if (!session) return '未知设备'
  return [session.device, session.browser, session.os].filter(Boolean).join(' · ') || '未知设备'
}

function formatSessionTime(value: number | undefined) {
  return value ? new Date(value).toLocaleString('zh-CN') : '未知'
}

onBeforeUnmount(() => {
  if (turnstileWidgetId.value !== null) window.turnstile?.remove?.(turnstileWidgetId.value)
})
</script>

<template>
  <div class="login-page">
    <div class="theme-toggle">
      <md-icon-button :aria-label="themeButtonLabel" :title="themeModeLabel" @click="toggleTheme">
        <md-icon>{{ themeIcon }}</md-icon>
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

    <ConfirmDialog
      :open="!!takeoverPrompt"
      title="账户当前在线"
      :message="takeoverMessage"
      :icon="takeoverDeviceIcon"
      confirm-label="挤下线并登录"
      pending-label="正在切换…"
      :pending="takeoverPending"
      :destructive="true"
      @confirm="confirmTakeover"
      @cancel="cancelTakeover"
    >
      <dl v-if="takeoverPrompt?.session" class="online-session-detail">
        <div><dt>在线设备</dt><dd class="online-device"><DeviceClientIcon :client="takeoverPrompt.session" /><span>{{ formatClient(takeoverPrompt.session) }}</span></dd></div>
        <div><dt>连接地址</dt><dd><code>{{ takeoverPrompt.session.ip || '未知' }}</code></dd></div>
        <div v-if="takeoverPrompt.session.location"><dt>IP 归属地</dt><dd>{{ takeoverPrompt.session.location }}</dd></div>
        <div><dt>最近活动</dt><dd>{{ formatSessionTime(takeoverPrompt.session.lastSeenAt) }}</dd></div>
      </dl>
    </ConfirmDialog>
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
  display: flex;
  align-items: center;
  gap: 4px;
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

.online-session-detail {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 8px;
  background: var(--md-sys-color-surface-container);
}

.online-session-detail div {
  min-width: 0;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
}

.online-session-detail dt,
.online-session-detail dd {
  min-width: 0;
  margin: 0;
  font-size: 12px;
}

.online-session-detail dt {
  color: var(--md-sys-color-on-surface-variant);
}

.online-session-detail dd {
  overflow-wrap: anywhere;
}

.online-device {
  display: flex;
  align-items: center;
  gap: 9px;
}

.online-device span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.online-session-detail code {
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
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
