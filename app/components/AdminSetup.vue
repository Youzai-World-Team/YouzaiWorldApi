<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ThemeMode } from '../composables/useThemeTransition'

const entry = ref('')
const username = ref('admin')
const turnstileSiteKey = ref('')
const turnstileSecret = ref('')
const turnstileHostnames = ref('')
const gameApiKey = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const showTurnstileSecret = ref(false)
const showGameApiKey = ref(false)
const loading = ref(false)
const dark = ref(false)
const themeMode = ref<ThemeMode>('system')
const { toggleTheme, themeIcon, themeModeLabel, themeButtonLabel } = useThemeTransition(dark, themeMode)
const { showToast } = useToast()
const { policy: passwordPolicy, load: loadPasswordPolicy, validate: validatePasswordPolicy } = usePasswordPolicy()
const reservedEntries = new Set([
  'login', 'account', 'activity', 'donors', 'bans', 'updates', 'game-accounts', 'game-cosmetics',
  'game-stats', 'game-account-email-templates', 'admin-users', 'audit-logs', 'chat', 'mail', 'settings', 'permissions',
  'api', '_nuxt', '_ipx', 'favicon', '__nuxt_error',
])

onMounted(async () => {
  void loadPasswordPolicy()
  try {
    const state = await $fetch<{ turnstile?: { siteKey?: string; hostnames?: string } }>('/api/auth/setup')
    if (state.turnstile?.siteKey) turnstileSiteKey.value = state.turnstile.siteKey
    if (state.turnstile?.hostnames) turnstileHostnames.value = state.turnstile.hostnames
  } catch {}
})

async function submit() {
  if (loading.value) return
  const normalizedEntry = entry.value.trim().replace(/^\/+|\/+$/g, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{11,63}$/.test(normalizedEntry)
      || reservedEntries.has(normalizedEntry.toLowerCase())) {
    showToast('登录入口格式不正确或与现有页面冲突', 'error')
    return
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/.test(username.value.trim())) {
    showToast('管理员用户名需要为 3 至 32 位字母、数字、下划线或连字符', 'error')
    return
  }
  if (password.value.length < 12 || password.value.length > 128) {
    showToast('后台密码需要为 12 至 128 位', 'error')
    return
  }
  const passwordPolicyError = validatePasswordPolicy(password.value, 12, '后台密码')
  if (passwordPolicyError) {
    showToast(passwordPolicyError, 'error')
    return
  }
  if (password.value !== confirmPassword.value) {
    showToast('两次输入的密码不一致', 'error')
    return
  }
  if (!turnstileSiteKey.value.trim() || /\s/.test(turnstileSiteKey.value.trim())) {
    showToast('请填写有效的 Turnstile 站点密钥', 'error')
    return
  }
  if (!turnstileSecret.value.trim() || /\s/.test(turnstileSecret.value.trim())) {
    showToast('请填写 Turnstile 服务端密钥', 'error')
    return
  }
  if (!turnstileHostnames.value.trim()) {
    showToast('请填写 Turnstile 允许的域名', 'error')
    return
  }
  if (gameApiKey.value.trim().length < 32 || gameApiKey.value.trim().length > 512 || /\s/.test(gameApiKey.value.trim())) {
    showToast('游戏 API 密钥长度需要为 32 至 512 位且不能包含空白字符', 'error')
    return
  }

  loading.value = true
  try {
    const result = await $fetch<{ entry: string }>('/api/auth/setup', {
      method: 'POST',
      body: {
        username: username.value.trim(),
        entry: normalizedEntry,
        password: password.value,
        confirmPassword: confirmPassword.value,
        turnstileSiteKey: turnstileSiteKey.value.trim(),
        turnstileSecret: turnstileSecret.value.trim(),
        turnstileHostnames: turnstileHostnames.value.trim(),
        gameApiKey: gameApiKey.value.trim(),
      },
    })
    useEntry().remember(result.entry)
    await navigateTo('/' + result.entry)
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '初始化失败', 'error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="setup-page">
    <div class="theme-toggle">
      <md-icon-button :aria-label="themeButtonLabel" :title="themeModeLabel" @click="toggleTheme">
        <md-icon>{{ themeIcon }}</md-icon>
      </md-icon-button>
    </div>

    <section class="setup-panel">
      <div class="setup-heading">
        <md-icon>admin_panel_settings</md-icon>
        <h1>初始化后台</h1>
      </div>

      <div class="setup-form">
        <md-outlined-text-field
          label="首个管理员用户名"
          supporting-text="3 至 32 位"
          autocomplete="username"
          :value="username"
          @input="username = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <md-outlined-text-field
          label="后台登录入口"
          supporting-text="12 至 64 位"
          autocomplete="off"
          spellcheck="false"
          :value="entry"
          @input="entry = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <md-outlined-text-field
          label="Turnstile 站点密钥"
          supporting-text="可公开的 Site Key"
          autocomplete="off"
          spellcheck="false"
          :value="turnstileSiteKey"
          @input="turnstileSiteKey = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <div class="password-field">
          <md-outlined-text-field
            :type="showTurnstileSecret ? 'text' : 'password'"
            label="Turnstile 服务端密钥"
            supporting-text="Secret Key 只保存到服务端"
            autocomplete="new-password"
            :value="turnstileSecret"
            @input="turnstileSecret = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
          <md-icon-button :aria-label="showTurnstileSecret ? '隐藏服务端密钥' : '显示服务端密钥'" @click="showTurnstileSecret = !showTurnstileSecret">
            <md-icon>{{ showTurnstileSecret ? 'visibility_off' : 'visibility' }}</md-icon>
          </md-icon-button>
        </div>

        <md-outlined-text-field
          label="Turnstile 允许的域名"
          supporting-text="多个域名用英文逗号分隔"
          autocomplete="off"
          spellcheck="false"
          :value="turnstileHostnames"
          @input="turnstileHostnames = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <div class="password-field">
          <md-outlined-text-field
            :type="showGameApiKey ? 'text' : 'password'"
            label="YZWC_GAME_API_KEY"
            supporting-text="需要与 Minecraft 模组配置中的密钥完全一致，至少 32 位"
            autocomplete="new-password"
            spellcheck="false"
            :value="gameApiKey"
            @input="gameApiKey = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
          <md-icon-button :aria-label="showGameApiKey ? '隐藏游戏 API 密钥' : '显示游戏 API 密钥'" @click="showGameApiKey = !showGameApiKey">
            <md-icon>{{ showGameApiKey ? 'visibility_off' : 'visibility' }}</md-icon>
          </md-icon-button>
        </div>

        <div class="password-field">
          <md-outlined-text-field
            :type="showPassword ? 'text' : 'password'"
            label="后台密码"
            autocomplete="new-password"
            :value="password"
            @input="password = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
          <md-icon-button :aria-label="showPassword ? '隐藏密码' : '显示密码'" @click="showPassword = !showPassword">
            <md-icon>{{ showPassword ? 'visibility_off' : 'visibility' }}</md-icon>
          </md-icon-button>
        </div>
        <PasswordStrength
          :password="password"
          :min-length="12"
          :required-score="passwordPolicy.enabled ? passwordPolicy.minimumScore : 0"
        />

        <md-outlined-text-field
          :type="showPassword ? 'text' : 'password'"
          label="确认后台密码"
          autocomplete="new-password"
          :value="confirmPassword"
          @input="confirmPassword = ($event.target as HTMLInputElement).value"
          @keydown.enter="submit"
        ></md-outlined-text-field>

        <md-filled-button :disabled="loading" @click="submit">
          {{ loading ? '正在初始化…' : '完成初始化' }}
        </md-filled-button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.setup-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
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

.setup-panel {
  width: min(420px, 100%);
  padding: 28px;
  border-radius: 8px;
  background: var(--md-sys-color-surface-container);
}

.setup-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.setup-heading md-icon {
  color: var(--md-sys-color-primary);
  font-size: 28px;
}

.setup-heading h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0;
}

.setup-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.password-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px;
  align-items: center;
  gap: 4px;
}

md-outlined-text-field,
md-filled-button {
  width: 100%;
}

@media (max-width: 480px) {
  .setup-page {
    place-items: start center;
    padding: 72px 16px max(24px, env(safe-area-inset-bottom));
  }

  .theme-toggle {
    top: 8px;
    right: 8px;
  }

  .setup-panel {
    padding: 20px;
  }

  .setup-heading h1 {
    font-size: 22px;
  }
}
</style>
