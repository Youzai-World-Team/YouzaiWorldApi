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
  admin: ScopeState | null
  chat: ScopeState | null
}

type SettingSource = 'database' | 'env' | 'none'

interface McsmConfig {
  baseUrl: string
  baseUrlSource: SettingSource
  apiKeyConfigured: boolean
  apiKeySource: SettingSource
  backupDir: string
  configured: boolean
}

interface McsmProbe {
  ok: boolean
  userName: string
  permissionLabel: string
  instanceCount: number
  message: string
}

const endpoint = '/api/admin/turnstile'

const loading = ref(true)
const saving = ref<TurnstileScope | null>(null)
const showSecret = reactive<Record<TurnstileScope, boolean>>({ admin: false, chat: false })
const gameApiKey = ref('')
const showGameApiKey = ref(false)
const gameApiKeyLoading = ref(true)
const savingGameApiKey = ref(false)
const inboundMailKey = ref('')
const showInboundMailKey = ref(false)
const inboundMailKeyLoading = ref(true)
const savingInboundMailKey = ref(false)
const inboundMailKeySource = ref<'database' | 'env' | 'none'>('none')
const mcsmForm = reactive({ baseUrl: '', apiKey: '', backupDir: '/backups' })
const mcsmState = ref<McsmConfig | null>(null)
const mcsmProbe = ref<McsmProbe | null>(null)
const showMcsmApiKey = ref(false)
const mcsmLoading = ref(true)
const savingMcsm = ref(false)
const securityEntryInput = ref('')
const currentSecurityEntry = ref('')
const securityEntryLoading = ref(true)
const savingSecurityEntry = ref(false)
const access = useAdminAccess()
const { entry: entryState } = useEntry()
const canEditPage = computed(() => access.levelForKey('settings') === 'edit')
const canManageSecurityEntry = computed(() => access.user.value?.isOwner === true)
const gameApiKeyLevel = computed(() => access.featureLevelForKey('settings-game-api-key'))
const canViewGameApiKey = computed(() => gameApiKeyLevel.value !== 'hidden')
const canEditGameApiKey = computed(() => canEditPage.value && gameApiKeyLevel.value === 'edit')
const inboundMailKeyLevel = computed(() => access.featureLevelForKey('settings-inbound-mail-key'))
const canViewInboundMailKey = computed(() => inboundMailKeyLevel.value !== 'hidden')
const canEditInboundMailKey = computed(() => canEditPage.value && inboundMailKeyLevel.value === 'edit')
const mcsmLevel = computed(() => access.featureLevelForKey('settings-mcsm'))
const canViewMcsm = computed(() => mcsmLevel.value !== 'hidden')
const canEditMcsm = computed(() => canEditPage.value && mcsmLevel.value === 'edit')
const adminTurnstileLevel = computed(() => access.featureLevelForKey('settings-turnstile-admin'))
const chatTurnstileLevel = computed(() => access.featureLevelForKey('settings-turnstile-chat'))
const canViewAdminTurnstile = computed(() => adminTurnstileLevel.value !== 'hidden')
const canViewChatTurnstile = computed(() => chatTurnstileLevel.value !== 'hidden')
const canEditAdminTurnstile = computed(() => canEditPage.value && adminTurnstileLevel.value === 'edit')
const canEditChatTurnstile = computed(() => canEditPage.value && chatTurnstileLevel.value === 'edit')

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
  void loadSecrets()
})

// 三块密钥/凭据都要先拿到最新的功能权限才知道能不能读，所以共用一次 /api/auth/me。
async function loadSecrets() {
  gameApiKeyLoading.value = true
  inboundMailKeyLoading.value = true
  mcsmLoading.value = true
  try {
    const auth = await $fetch<{ user: { isOwner: boolean; featurePermissions?: Record<string, 'hidden' | 'view' | 'edit'> } }>('/api/auth/me')
    access.updateProfile(auth.user)
  } catch (e: any) {
    gameApiKeyLoading.value = false
    inboundMailKeyLoading.value = false
    mcsmLoading.value = false
    securityEntryLoading.value = false
    showToast(e?.data?.statusMessage || '权限加载失败', 'error')
    return
  }
  await Promise.all([loadSecurityEntry(), loadGameApiKey(), loadInboundMailKey(), loadMcsm()])
}

async function loadSecurityEntry() {
  securityEntryLoading.value = true
  try {
    if (!canManageSecurityEntry.value) return
    const result = await $fetch<{ entry: string }>('/api/auth/entry')
    currentSecurityEntry.value = result.entry
    securityEntryInput.value = result.entry
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '安全入口加载失败', 'error')
  } finally {
    securityEntryLoading.value = false
  }
}

async function saveSecurityEntry() {
  if (savingSecurityEntry.value || !canManageSecurityEntry.value) return
  const entry = securityEntryInput.value.trim().replace(/^\/+|\/+$/g, '')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{11,63}$/.test(entry)) {
    showToast('安全入口需要为 12 至 64 位字母、数字、下划线或连字符', 'error')
    return
  }
  savingSecurityEntry.value = true
  try {
    const result = await $fetch<{ entry: string }>('/api/auth/entry', {
      method: 'POST',
      body: { entry },
    })
    currentSecurityEntry.value = result.entry
    securityEntryInput.value = result.entry
    entryState.value = result.entry
    if (import.meta.client) sessionStorage.setItem('security-entry', result.entry)
    showToast(`安全入口已更新为 /${result.entry}`)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '安全入口保存失败', 'error')
  } finally {
    savingSecurityEntry.value = false
  }
}

async function loadGameApiKey() {
  try {
    if (!canViewGameApiKey.value) return
    const settings = await $fetch<{ gameApiKey: string }>('/api/auth/game-api-key')
    gameApiKey.value = settings.gameApiKey || ''
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '游戏 API 密钥加载失败', 'error')
  } finally {
    gameApiKeyLoading.value = false
  }
}

async function loadInboundMailKey() {
  try {
    if (!canViewInboundMailKey.value) return
    const settings = await $fetch<{ inboundMailKey: string; source: 'database' | 'env' | 'none' }>('/api/auth/inbound-mail-key')
    inboundMailKey.value = settings.inboundMailKey || ''
    inboundMailKeySource.value = settings.source
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '域名邮件投递密钥加载失败', 'error')
  } finally {
    inboundMailKeyLoading.value = false
  }
}

async function loadMcsm() {
  try {
    if (!canViewMcsm.value) return
    const config = await $fetch<McsmConfig>('/api/admin/mcsm-settings')
    mcsmState.value = config
    mcsmForm.baseUrl = config.baseUrl
    mcsmForm.backupDir = config.backupDir
    // 服务端不回显 ApiKey，输入框留空即表示沿用旧值。
    mcsmForm.apiKey = ''
  } catch (e: any) {
    showToast(e?.data?.statusMessage || 'MCSM 面板配置加载失败', 'error')
  } finally {
    mcsmLoading.value = false
  }
}

async function saveMcsm() {
  if (savingMcsm.value || !canEditMcsm.value) return
  if (!mcsmForm.baseUrl.trim()) {
    showToast('请填写 MCSM 面板地址', 'error')
    return
  }
  if (!mcsmState.value?.apiKeyConfigured && !mcsmForm.apiKey.trim()) {
    showToast('首次配置必须填写 MCSM ApiKey', 'error')
    return
  }
  savingMcsm.value = true
  mcsmProbe.value = null
  try {
    const result = await $fetch<McsmConfig & { probe: McsmProbe }>('/api/admin/mcsm-settings', {
      method: 'PATCH',
      body: {
        baseUrl: mcsmForm.baseUrl.trim(),
        apiKey: mcsmForm.apiKey,
        backupDir: mcsmForm.backupDir.trim(),
      },
    })
    const { probe, ...config } = result
    mcsmState.value = config
    mcsmForm.baseUrl = config.baseUrl
    mcsmForm.backupDir = config.backupDir
    mcsmForm.apiKey = ''
    showMcsmApiKey.value = false
    mcsmProbe.value = probe
    showToast(probe.ok ? '已保存，面板连接正常' : '配置已保存，但连接面板失败', probe.ok ? 'info' : 'error')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '保存失败', 'error')
  } finally {
    savingMcsm.value = false
  }
}

async function load() {
  loading.value = true
  try {
    const result = await $fetch<TurnstileResponse>(endpoint)
    for (const scope of ['admin', 'chat'] as TurnstileScope[]) {
      const config = result[scope]
      if (!config) {
        forms[scope].siteKey = ''
        forms[scope].hostnames = ''
        forms[scope].secret = ''
        continue
      }
      Object.assign(state[scope], config)
      forms[scope].siteKey = config.siteKey
      forms[scope].hostnames = config.hostnames
      forms[scope].secret = ''
    }
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '加载失败', 'error')
  } finally {
    loading.value = false
  }
}

async function save(scope: TurnstileScope) {
  const canEditScope = scope === 'admin' ? canEditAdminTurnstile.value : canEditChatTurnstile.value
  if (saving.value || !canEditScope) return
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
  if (savingGameApiKey.value || !canEditGameApiKey.value) return
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

async function saveInboundMailKey() {
  if (savingInboundMailKey.value || !canEditInboundMailKey.value) return
  const value = inboundMailKey.value.trim()
  if (value.length < 32 || value.length > 512 || /\s/.test(value)) {
    showToast('域名邮件投递密钥长度需要为 32 至 512 位且不能包含空白字符', 'error')
    return
  }
  savingInboundMailKey.value = true
  try {
    const result = await $fetch<{ inboundMailKey: string; source: 'database' | 'env' | 'none' }>('/api/auth/inbound-mail-key', {
      method: 'POST',
      body: { inboundMailKey: value },
    })
    inboundMailKey.value = result.inboundMailKey
    inboundMailKeySource.value = result.source
    showToast('域名邮件投递密钥已更新，请同步修改 Worker 的 INBOUND_MAIL_KEY')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '保存失败', 'error')
  } finally {
    savingInboundMailKey.value = false
  }
}

/** 浏览器里生成 32 字节随机值，避免管理员自己想一串不够随机的密钥。 */
function generateInboundMailKey() {
  if (!canEditInboundMailKey.value) return
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  inboundMailKey.value = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  showInboundMailKey.value = true
  showToast('已生成新密钥，记得保存并同步到 Worker')
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">站点设置</h1>

    <div v-if="canManageSecurityEntry" class="card">
      <h2 class="card-title">后台安全入口</h2>
      <p class="card-note">当前入口：<code>/{{ currentSecurityEntry || '…' }}</code></p>
      <div class="setting-form">
        <md-outlined-text-field
          label="安全入口"
          supporting-text="12 至 64 位字母、数字、下划线或连字符"
          autocomplete="off"
          spellcheck="false"
          :disabled="securityEntryLoading"
          :value="securityEntryInput"
          @input="securityEntryInput = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
        <div class="form-actions">
          <md-filled-button :disabled="securityEntryLoading || savingSecurityEntry" @click="saveSecurityEntry">
            {{ savingSecurityEntry ? '保存中…' : '保存安全入口' }}
          </md-filled-button>
        </div>
      </div>
    </div>

    <div v-if="canViewGameApiKey" class="card">
      <h2 class="card-title">游戏 API 密钥</h2>

      <div class="setting-form">
        <div class="password-field">
          <md-outlined-text-field
            :type="showGameApiKey ? 'text' : 'password'"
            label="YZWC_GAME_API_KEY"
            supporting-text="必须与服务器模组配置中的密钥完全一致"
            autocomplete="off"
            spellcheck="false"
            :disabled="gameApiKeyLoading"
            :readonly="!canEditGameApiKey"
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
        <div v-if="canEditGameApiKey" class="form-actions">
          <md-filled-button :disabled="gameApiKeyLoading || savingGameApiKey" @click="saveGameApiKey">
            {{ savingGameApiKey ? '保存中…' : '保存游戏 API 密钥' }}
          </md-filled-button>
        </div>
      </div>
    </div>

    <div v-if="canViewInboundMailKey" class="card">
      <h2 class="card-title">域名邮件投递密钥</h2>
      <p class="card-note">请勿与游戏 API 密钥复用。</p>

      <p v-if="!inboundMailKeyLoading && inboundMailKeySource === 'none'" class="inherit-warning">
        <md-icon>warning</md-icon>
        <span>尚未配置，收件投递接口会返回 503，「域名邮件」页会一直是空的。</span>
      </p>
      <p v-else-if="!inboundMailKeyLoading && inboundMailKeySource === 'env'" class="source-note">
        <md-icon>info</md-icon>
        <span>
          当前使用环境变量 <code>YZWC_INBOUND_MAIL_KEY</code>。在此保存后改用数据库值；Nitro 不读取根目录 <code>.env</code>。
        </span>
      </p>

      <div class="setting-form">
        <div class="password-field">
          <md-outlined-text-field
            :type="showInboundMailKey ? 'text' : 'password'"
            label="INBOUND_MAIL_KEY"
            supporting-text="32 至 512 位、不含空白字符；必须与 Worker 的 INBOUND_MAIL_KEY Secret 完全一致"
            autocomplete="off"
            spellcheck="false"
            :disabled="inboundMailKeyLoading"
            :readonly="!canEditInboundMailKey"
            :value="inboundMailKey"
            @input="inboundMailKey = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
          <md-icon-button
            :aria-label="showInboundMailKey ? '隐藏域名邮件投递密钥' : '显示域名邮件投递密钥'"
            :disabled="inboundMailKeyLoading"
            @click="showInboundMailKey = !showInboundMailKey"
          >
            <md-icon>{{ showInboundMailKey ? 'visibility_off' : 'visibility' }}</md-icon>
          </md-icon-button>
        </div>
        <div v-if="canEditInboundMailKey" class="form-actions">
          <md-filled-button :disabled="inboundMailKeyLoading || savingInboundMailKey" @click="saveInboundMailKey">
            {{ savingInboundMailKey ? '保存中…' : '保存投递密钥' }}
          </md-filled-button>
          <md-outlined-button :disabled="inboundMailKeyLoading || savingInboundMailKey" @click="generateInboundMailKey">
            <md-icon slot="icon">casino</md-icon>
            随机生成
          </md-outlined-button>
        </div>
        <p v-if="canEditInboundMailKey" class="card-note">
          保存后需在 Worker 执行 <code>npx wrangler secret put INBOUND_MAIL_KEY</code> 并填入相同值；不一致会拒收（401）。
        </p>
      </div>
    </div>

    <div v-if="canViewMcsm" class="card">
      <h2 class="card-title">MCSManager 面板</h2>
      <p class="card-note">ApiKey 权限与面板账户完全一致，请当作密码保管。</p>

      <p v-if="!mcsmLoading && !mcsmState?.configured" class="inherit-warning">
        <md-icon>warning</md-icon>
        <span>尚未配置，「服务器管理」页会一直提示去这里填写。</span>
      </p>
      <p v-else-if="!mcsmLoading && mcsmState?.apiKeySource === 'env'" class="source-note">
        <md-icon>info</md-icon>
        <span>
          当前使用环境变量 <code>YZWC_MCSM_API_KEY</code>。在此保存后改用数据库值；Nitro 不读取根目录 <code>.env</code>。
        </span>
      </p>

      <div class="setting-form">
        <md-outlined-text-field
          label="面板地址"
          supporting-text="形如 http://127.0.0.1:23333，不要带路径参数；反向代理下的路径前缀可以保留"
          autocomplete="off"
          spellcheck="false"
          :disabled="mcsmLoading"
          :readonly="!canEditMcsm"
          :value="mcsmForm.baseUrl"
          @input="mcsmForm.baseUrl = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <div class="password-field">
          <md-outlined-text-field
            :type="showMcsmApiKey ? 'text' : 'password'"
            label="MCSM ApiKey"
            :supporting-text="mcsmState?.apiKeyConfigured ? '已配置，留空表示不修改' : '尚未配置，必须填写'"
            autocomplete="new-password"
            spellcheck="false"
            :disabled="mcsmLoading"
            :readonly="!canEditMcsm"
            :value="mcsmForm.apiKey"
            @input="mcsmForm.apiKey = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
          <md-icon-button
            :aria-label="showMcsmApiKey ? '隐藏 ApiKey' : '显示 ApiKey'"
            :disabled="mcsmLoading"
            @click="showMcsmApiKey = !showMcsmApiKey"
          >
            <md-icon>{{ showMcsmApiKey ? 'visibility_off' : 'visibility' }}</md-icon>
          </md-icon-button>
        </div>

        <md-outlined-text-field
          label="备份目录"
          supporting-text="实例目录下的相对路径，默认 /backups；只能用字母、数字、点、下划线、短横线和斜杠"
          autocomplete="off"
          spellcheck="false"
          :disabled="mcsmLoading"
          :readonly="!canEditMcsm"
          :value="mcsmForm.backupDir"
          @input="mcsmForm.backupDir = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <div v-if="canEditMcsm" class="form-actions">
          <md-filled-button :disabled="mcsmLoading || savingMcsm" @click="saveMcsm">
            {{ savingMcsm ? '保存并测试中…' : '保存并测试连接' }}
          </md-filled-button>
        </div>

        <p v-if="mcsmProbe" :class="mcsmProbe.ok ? 'source-note' : 'inherit-warning'">
          <md-icon>{{ mcsmProbe.ok ? 'check_circle' : 'error' }}</md-icon>
          <span v-if="mcsmProbe.ok">
            连接成功：面板账户 <strong>{{ mcsmProbe.userName }}</strong>（{{ mcsmProbe.permissionLabel }}），
            这把 ApiKey 可管理 {{ mcsmProbe.instanceCount }} 个实例。
          </span>
          <span v-else>配置已保存，但连接面板失败：{{ mcsmProbe.message }}</span>
        </p>
      </div>
    </div>

    <div v-if="canViewAdminTurnstile" class="card">
      <h2 class="card-title">后台登录人机验证</h2>
      <p class="card-note">保护本后台的登录页，允许域名应填写 API 站点域名。</p>

      <div class="setting-form">
        <md-outlined-text-field
          label="站点密钥"
          supporting-text="可公开的 Site Key"
          autocomplete="off"
          spellcheck="false"
          :value="forms.admin.siteKey"
          :readonly="!canEditAdminTurnstile"
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
            :readonly="!canEditAdminTurnstile"
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
          :readonly="!canEditAdminTurnstile"
          @input="forms.admin.hostnames = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <div v-if="canEditAdminTurnstile" class="form-actions">
          <md-filled-button :disabled="loading || saving === 'admin'" @click="save('admin')">
            {{ saving === 'admin' ? '保存中…' : '保存' }}
          </md-filled-button>
        </div>
      </div>
    </div>

    <div v-if="canViewChatTurnstile" class="card">
      <h2 class="card-title">聊天区人机验证</h2>
      <p class="card-note">
        保护官网首页聊天区的发言与玩家登录，允许域名应填写主站域名。
      </p>
      <p v-if="state.chat.inherited && !loading" class="inherit-warning">
        <md-icon>warning</md-icon>
        <span>
          当前复用后台登录配置；域名不同会导致发送校验失败，请填写聊天区专用凭据。
        </span>
      </p>

      <div class="setting-form">
        <md-outlined-text-field
          label="站点密钥"
          supporting-text="可公开的 Site Key"
          autocomplete="off"
          spellcheck="false"
          :value="forms.chat.siteKey"
          :readonly="!canEditChatTurnstile"
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
            :readonly="!canEditChatTurnstile"
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
          :readonly="!canEditChatTurnstile"
          @input="forms.chat.hostnames = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>

        <div v-if="canEditChatTurnstile" class="form-actions">
          <md-filled-button :disabled="loading || saving === 'chat'" @click="save('chat')">
            {{ saving === 'chat' ? '保存中…' : '保存' }}
          </md-filled-button>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">生产环境配置</h2>
      <p class="card-note">
        Nitro 运行时不会读取项目根目录的 <code>.env</code>；请使用本页保存或进程环境变量。
      </p>
    </div>
  </div>
</template>

<style scoped>
.card + .card {
  margin-top: 20px;
}

.card-note {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--md-sys-color-on-surface-variant);
}

.card-note code {
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

.source-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 16px 0 0;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--md-sys-color-surface-container-high, var(--md-sys-color-surface-variant));
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
  line-height: 1.6;
}

.source-note md-icon {
  flex-shrink: 0;
  --md-icon-size: 20px;
}

.source-note code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--md-sys-color-surface);
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
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
  flex-wrap: wrap;
  gap: 12px;
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
