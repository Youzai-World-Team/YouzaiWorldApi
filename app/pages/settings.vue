<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'

useHead({ title: '站点设置' })

type TurnstileScope = 'admin' | 'chat'

interface ScopeState {
  siteKey: string
  hostnames: string
  secretConfigured: boolean
  inherited?: boolean
}

interface TurnstileResponse {
  admin: ScopeState
  chat: ScopeState
}

const endpoint = '/api/admin/turnstile'

const loading = ref(true)
const saving = ref<TurnstileScope | null>(null)
const showSecret = reactive<Record<TurnstileScope, boolean>>({ admin: false, chat: false })
const gameApiKey = ref('')
const showGameApiKey = ref(false)
const gameApiKeyLoading = ref(true)
const savingGameApiKey = ref(false)
const access = useAdminAccess()
const canEdit = computed(() => access.levelForKey('settings') === 'edit')

// 服务端不回显密钥，密钥框留空即表示「沿用已有密钥」。
const forms = reactive<Record<TurnstileScope, { siteKey: string; secret: string; hostnames: string }>>({
  admin: { siteKey: '', secret: '', hostnames: '' },
  chat: { siteKey: '', secret: '', hostnames: '' },
})
const state = reactive<Record<TurnstileScope, ScopeState>>({
  admin: { siteKey: '', hostnames: '', secretConfigured: false },
  chat: { siteKey: '', hostnames: '', secretConfigured: false, inherited: true },
})

const { showToast } = useToast()

onMounted(() => {
  void load()
  void loadGameApiKey()
})

async function loadGameApiKey() {
  gameApiKeyLoading.value = true
  try {
    const [auth, settings] = await Promise.all([
      $fetch<{ user: { isOwner: boolean } }>('/api/auth/me'),
      $fetch<{ gameApiKey: string }>('/api/auth/game-api-key'),
    ])
    access.updateProfile(auth.user)
    gameApiKey.value = settings.gameApiKey || ''
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '游戏 API 密钥加载失败', 'error')
  } finally {
    gameApiKeyLoading.value = false
  }
}

async function load() {
  loading.value = true
  try {
    const result = await $fetch<TurnstileResponse>(endpoint)
    for (const scope of ['admin', 'chat'] as TurnstileScope[]) {
      Object.assign(state[scope], result[scope])
      forms[scope].siteKey = result[scope].siteKey
      forms[scope].hostnames = result[scope].hostnames
      forms[scope].secret = ''
    }
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '加载失败', 'error')
  } finally {
    loading.value = false
  }
}

async function save(scope: TurnstileScope) {
  if (saving.value || !canEdit.value) return
  const form = forms[scope]
  if (!form.siteKey.trim()) {
    showToast('请填写站点密钥', 'error')
    return
  }
  if (!form.hostnames.trim()) {
    showToast('请填写允许的域名', 'error')
    return
  }
  saving.value = scope
  try {
    await $fetch(endpoint, {
      method: 'PATCH',
      body: {
        scope,
        siteKey: form.siteKey.trim(),
        secret: form.secret,
        hostnames: form.hostnames.trim(),
      },
    })
    showToast('已保存')
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '保存失败', 'error')
  } finally {
    saving.value = null
  }
}

async function saveGameApiKey() {
  if (savingGameApiKey.value || !canEdit.value) return
  const value = gameApiKey.value.trim()
  if (value.length < 32 || value.length > 512 || /\s/.test(value)) {
    showToast('游戏 API 密钥长度需要为 32 至 512 位且不能包含空白字符', 'error')
    return
  }
  savingGameApiKey.value = true
  try {
    const result = await $fetch<{ gameApiKey: string }>('/api/auth/game-api-key', {
      method: 'POST',
      body: { gameApiKey: value },
    })
    gameApiKey.value = result.gameApiKey
    showToast('游戏 API 密钥已更新，请同步修改 Minecraft 模组配置')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '保存失败', 'error')
  } finally {
    savingGameApiKey.value = false
  }
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">站点设置</h1>
    <p class="page-subtitle">
      后台登录的 widget 跑在 API 域名下，
      官网聊天区的 widget 跑在主站域名下，混用会导致校验域名不匹配。
    </p>

    <div class="card">
      <h2 class="card-title">游戏 API 密钥</h2>
      <p class="card-note">用于 Minecraft 模组与 API 服务端的签名通信。拥有站点设置编辑权限的账户可以修改。</p>

      <div class="setting-form">
        <div class="password-field">
          <md-outlined-text-field
            :type="showGameApiKey ? 'text' : 'password'"
            label="YZWC_GAME_API_KEY"
            supporting-text="必须与服务器模组配置中的密钥完全一致"
            autocomplete="off"
            spellcheck="false"
            :disabled="gameApiKeyLoading"
            :readonly="!canEdit"
            :value="gameApiKey"
            @input="gameApiKey = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
          <md-icon-button
            :aria-label="showGameApiKey ? '隐藏游戏 API 密钥' : '显示游戏 API 密钥'"
            :disabled="gameApiKeyLoading"
            @click="showGameApiKey = !showGameApiKey"
          >
            <md-icon>{{ showGameApiKey ? 'visibility_off' : 'visibility' }}</md-icon>
          </md-icon-button>
        </div>
        <div v-if="canEdit" class="form-actions">
          <md-filled-button :disabled="gameApiKeyLoading || savingGameApiKey" @click="saveGameApiKey">
            {{ savingGameApiKey ? '保存中…' : '保存游戏 API 密钥' }}
          </md-filled-button>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">后台登录人机验证</h2>
      <p class="card-note">保护本后台的登录页，允许域名应填写 API 站点域名。</p>

      <div class="setting-form">
        <md-outlined-text-field
          label="站点密钥"
          supporting-text="可公开的 Site Key"
          autocomplete="off"
          spellcheck="false"
          :value="forms.admin.siteKey"
          :readonly="!canEdit"
          @input="forms.admin.siteKey = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <div class="password-field">
          <md-outlined-text-field
            :type="showSecret.admin ? 'text' : 'password'"
            label="服务端密钥"
            :supporting-text="state.admin.secretConfigured ? '已配置，留空表示不修改' : '尚未配置，必须填写'"
            autocomplete="new-password"
            spellcheck="false"
            :value="forms.admin.secret"
            :readonly="!canEdit"
            @input="forms.admin.secret = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
          <md-icon-button
            :aria-label="showSecret.admin ? '隐藏服务端密钥' : '显示服务端密钥'"
            @click="showSecret.admin = !showSecret.admin"
          >
            <md-icon>{{ showSecret.admin ? 'visibility_off' : 'visibility' }}</md-icon>
          </md-icon-button>
        </div>

        <md-outlined-text-field
          label="允许的域名"
          supporting-text="多个域名用英文逗号分隔，例如 api.mcyzw.top"
          autocomplete="off"
          spellcheck="false"
          :value="forms.admin.hostnames"
          :readonly="!canEdit"
          @input="forms.admin.hostnames = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <div v-if="canEdit" class="form-actions">
          <md-filled-button :disabled="loading || saving === 'admin'" @click="save('admin')">
            {{ saving === 'admin' ? '保存中…' : '保存' }}
          </md-filled-button>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">聊天区人机验证</h2>
      <p class="card-note">
        保护官网首页聊天区的发言与玩家登录，允许域名应填写主站域名。
      </p>
      <p v-if="state.chat.inherited && !loading" class="inherit-warning">
        <md-icon>warning</md-icon>
        <span>
          当前未单独配置，正在复用上面「后台登录」那一套。
          由于两者允许域名不同，聊天区会出现「前端显示验证通过、发送却提示人机验证失败」。
          请在此填写聊天区专用凭据。
        </span>
      </p>

      <div class="setting-form">
        <md-outlined-text-field
          label="站点密钥"
          supporting-text="可公开的 Site Key"
          autocomplete="off"
          spellcheck="false"
          :value="forms.chat.siteKey"
          :readonly="!canEdit"
          @input="forms.chat.siteKey = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <div class="password-field">
          <md-outlined-text-field
            :type="showSecret.chat ? 'text' : 'password'"
            label="服务端密钥"
            :supporting-text="state.chat.secretConfigured && !state.chat.inherited ? '已配置，留空表示不修改' : '尚未单独配置，必须填写'"
            autocomplete="new-password"
            spellcheck="false"
            :value="forms.chat.secret"
            :readonly="!canEdit"
            @input="forms.chat.secret = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
          <md-icon-button
            :aria-label="showSecret.chat ? '隐藏服务端密钥' : '显示服务端密钥'"
            @click="showSecret.chat = !showSecret.chat"
          >
            <md-icon>{{ showSecret.chat ? 'visibility_off' : 'visibility' }}</md-icon>
          </md-icon-button>
        </div>

        <md-outlined-text-field
          label="允许的域名"
          supporting-text="多个域名用英文逗号分隔，例如 mcyzw.top,www.mcyzw.top"
          autocomplete="off"
          spellcheck="false"
          :value="forms.chat.hostnames"
          :readonly="!canEdit"
          @input="forms.chat.hostnames = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <div v-if="canEdit" class="form-actions">
          <md-filled-button :disabled="loading || saving === 'chat'" @click="save('chat')">
            {{ saving === 'chat' ? '保存中…' : '保存' }}
          </md-filled-button>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">配置来源优先级</h2>
      <ol class="priority-list">
        <li>本页保存的数据库设置（最高，生产环境推荐）</li>
        <li>进程环境变量（<code>TURNSTILE_*</code> / <code>TURNSTILE_CHAT_*</code>）</li>
        <li>聊天区未配置时回退到后台登录那一套</li>
      </ol>
      <p class="card-note">
        开发环境会读取项目根目录的 <code>.env</code>，但生产环境的 Nitro 运行时不会读它，
        所以线上请用本页保存，或在服务的进程环境里设置变量。
      </p>
    </div>
  </div>
</template>

<style scoped>
.page-subtitle {
  margin: -8px 0 24px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--md-sys-color-on-surface-variant);
}

.card + .card {
  margin-top: 20px;
}

.card-note {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--md-sys-color-on-surface-variant);
}

.card-note code,
.priority-list code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--md-sys-color-surface);
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.inherit-warning {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 16px 0 0;
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(197, 34, 31, 0.1);
  color: var(--md-sys-color-error);
  font-size: 13px;
  line-height: 1.6;
}

.inherit-warning md-icon {
  flex-shrink: 0;
  --md-icon-size: 20px;
}

.setting-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 560px;
  margin-top: 20px;
}

.setting-form md-outlined-text-field {
  width: 100%;
}

.password-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.password-field md-outlined-text-field {
  flex: 1;
  min-width: 0;
}

.form-actions {
  display: flex;
  justify-content: flex-start;
}

.priority-list {
  margin: 16px 0 0;
  padding-left: 22px;
  font-size: 14px;
  line-height: 1.9;
  color: var(--md-sys-color-on-surface-variant);
}

@media (max-width: 640px) {
  .setting-form {
    max-width: none;
  }

  .form-actions md-filled-button {
    width: 100%;
  }
}
</style>
