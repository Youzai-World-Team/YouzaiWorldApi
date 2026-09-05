<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import {
  DEFAULT_PASSWORD_EXPIRY_POLICY,
  DEFAULT_PASSWORD_POLICY,
  MAX_PASSWORD_EXPIRY_DAYS,
  MIN_PASSWORD_EXPIRY_DAYS,
  passwordPolicyMinimumLength,
  passwordPolicyRequirements,
  passwordStrengthLabel,
  type PasswordPolicy,
  type PasswordPolicyMinimumScore,
  type PasswordExpiryPolicy,
} from '#shared/password-policy'

useHead({ title: '站点设置' })

type TurnstileScope = 'admin' | 'chat'

interface ScopeState {
  siteKey: string
  secret: string
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
  apiKey: string
  apiKeyConfigured: boolean
  apiKeySource: SettingSource
  configured: boolean
}

interface McsmProbe {
  ok: boolean
  userName: string
  permissionLabel: string
  instanceCount: number
  message: string
}

interface StatusHistoryStats {
  count: number
  oldestAt: number | null
  latestAt: number | null
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
const mcsmForm = reactive({ baseUrl: '', apiKey: '' })
const mcsmState = ref<McsmConfig | null>(null)
const mcsmProbe = ref<McsmProbe | null>(null)
const showMcsmApiKey = ref(false)
const mcsmLoading = ref(true)
const savingMcsm = ref(false)
const statusHistoryLoading = ref(true)
const statusHistoryClearing = ref(false)
const statusHistoryStats = ref<StatusHistoryStats>({ count: 0, oldestAt: null, latestAt: null })
const securityEntryInput = ref('')
const currentSecurityEntry = ref('')
const securityEntryLoading = ref(true)
const savingSecurityEntry = ref(false)
const passwordPolicyLoading = ref(true)
const savingPasswordPolicy = ref(false)
const passwordPolicyForm = reactive<PasswordPolicy>({ ...DEFAULT_PASSWORD_POLICY })
const passwordExpiryLoading = ref(true)
const savingPasswordExpiry = ref(false)
const passwordExpiryForm = reactive<PasswordExpiryPolicy>({ ...DEFAULT_PASSWORD_EXPIRY_POLICY })
const access = useAdminAccess()
const { entry: entryState } = useEntry()
const canEditPage = computed(() => access.levelForKey('settings') === 'edit')
const canManageSecurityEntry = computed(() => access.user.value?.isOwner === true)
const canManagePasswordExpiry = computed(() => access.user.value?.isOwner === true)
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

// 密钥只通过受权限保护且禁止缓存的接口回显，编辑后仍需手动保存。
const forms = reactive<Record<TurnstileScope, { siteKey: string; secret: string; hostnames: string }>>({
  admin: { siteKey: '', secret: '', hostnames: '' },
  chat: { siteKey: '', secret: '', hostnames: '' },
})
const state = reactive<Record<TurnstileScope, ScopeState>>({
  admin: { siteKey: '', secret: '', hostnames: '', secretConfigured: false },
  chat: { siteKey: '', secret: '', hostnames: '', secretConfigured: false, inherited: true },
})

const { showToast } = useToast()
const { apply: applyPasswordPolicy } = usePasswordPolicy()
const passwordPolicyMinimumLabel = computed(() => passwordStrengthLabel(passwordPolicyForm.minimumScore))
const passwordPolicyCurrentRequirements = computed(() => {
  const minimumLength = passwordPolicyForm.enabled
    ? passwordPolicyMinimumLength(passwordPolicyForm.minimumScore, 12)
    : 12
  return [
    `长度为 ${minimumLength} 至 128 位`,
    ...(passwordPolicyForm.enabled
      ? passwordPolicyRequirements('', 12, passwordPolicyForm.minimumScore)
          .slice(1)
          .map((requirement) => requirement.label)
      : []),
  ].join('、')
})

onMounted(() => {
  void load()
  void loadSecrets()
  void loadPasswordPolicySettings()
  void loadPasswordExpirySettings()
  void loadStatusHistoryStats()
})

async function loadStatusHistoryStats() {
  statusHistoryLoading.value = true
  try {
    statusHistoryStats.value = await $fetch<StatusHistoryStats>('/api/admin/status-history')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '状态历史统计加载失败', 'error')
  } finally {
    statusHistoryLoading.value = false
  }
}

function formatStatusHistoryTime(timestamp: number | null): string {
  if (!timestamp) return '暂无'
  const value = new Date(timestamp)
  return Number.isNaN(value.getTime()) ? '暂无' : value.toLocaleString('zh-CN')
}

async function clearStatusHistoryData() {
  if (statusHistoryClearing.value || !canEditPage.value) return
  if (!window.confirm('确定清除 API 服务端保存的全部服务器状态历史数据吗？此操作无法撤销，但不会删除 Worker 中最近 72 小时的数据。')) return
  statusHistoryClearing.value = true
  try {
    await $fetch('/api/admin/status-history', { method: 'DELETE' })
    showToast('服务器状态历史数据已清除')
    await loadStatusHistoryStats()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '清除状态历史数据失败', 'error')
  } finally {
    statusHistoryClearing.value = false
  }
}

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

async function loadPasswordPolicySettings() {
  passwordPolicyLoading.value = true
  try {
    const policy = await $fetch<PasswordPolicy>('/api/auth/password-policy')
    Object.assign(passwordPolicyForm, policy)
    applyPasswordPolicy(policy)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '后台账户密码策略加载失败', 'error')
  } finally {
    passwordPolicyLoading.value = false
  }
}

async function loadPasswordExpirySettings() {
  passwordExpiryLoading.value = true
  try {
    const policy = await $fetch<PasswordExpiryPolicy>('/api/auth/password-expiry')
    Object.assign(passwordExpiryForm, policy)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '后台密码有效期加载失败', 'error')
  } finally {
    passwordExpiryLoading.value = false
  }
}

function onPasswordExpiryToggle(event: Event) {
  passwordExpiryForm.enabled = Boolean((event.target as HTMLElement & { selected?: boolean }).selected)
}

function onPasswordExpiryDaysInput(event: Event) {
  const value = Math.trunc(Number((event.target as HTMLInputElement).value))
  if (Number.isInteger(value)) passwordExpiryForm.days = value
}

async function savePasswordExpiry() {
  if (savingPasswordExpiry.value || !canManagePasswordExpiry.value) return
  if (passwordExpiryForm.days < MIN_PASSWORD_EXPIRY_DAYS || passwordExpiryForm.days > MAX_PASSWORD_EXPIRY_DAYS) {
    showToast(`密码有效期需要为 ${MIN_PASSWORD_EXPIRY_DAYS} 至 ${MAX_PASSWORD_EXPIRY_DAYS} 天`, 'error')
    return
  }
  savingPasswordExpiry.value = true
  try {
    const policy = await $fetch<PasswordExpiryPolicy>('/api/admin/password-expiry', {
      method: 'PATCH',
      body: {
        enabled: passwordExpiryForm.enabled,
        days: passwordExpiryForm.days,
      },
    })
    Object.assign(passwordExpiryForm, policy)
    showToast(policy.enabled ? `后台密码有效期已设为 ${policy.days} 天` : '后台密码有效期已关闭')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '后台密码有效期保存失败', 'error')
  } finally {
    savingPasswordExpiry.value = false
  }
}

function onPasswordPolicyToggle(event: Event) {
  passwordPolicyForm.enabled = Boolean((event.target as HTMLElement & { selected?: boolean }).selected)
}

function onPasswordPolicyScoreInput(event: Event) {
  const value = Number((event.target as HTMLElement & { value?: number }).value)
  if (Number.isInteger(value) && value >= 1 && value <= 6) {
    passwordPolicyForm.minimumScore = value as PasswordPolicyMinimumScore
  }
}

async function savePasswordPolicy() {
  if (savingPasswordPolicy.value || !canEditPage.value) return
  savingPasswordPolicy.value = true
  try {
    const policy = await $fetch<PasswordPolicy>('/api/admin/password-policy', {
      method: 'PATCH',
      body: {
        enabled: passwordPolicyForm.enabled,
        minimumScore: passwordPolicyForm.minimumScore,
      },
    })
    Object.assign(passwordPolicyForm, policy)
    applyPasswordPolicy(policy)
    showToast(policy.enabled ? `后台账户密码最低复杂度已设为“${passwordStrengthLabel(policy.minimumScore)}”` : '后台账户密码复杂度强制要求已关闭')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '后台账户密码策略保存失败', 'error')
  } finally {
    savingPasswordPolicy.value = false
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
    mcsmForm.apiKey = config.apiKey
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
      },
    })
    const { probe, ...config } = result
    mcsmState.value = config
    mcsmForm.baseUrl = config.baseUrl
    mcsmForm.apiKey = config.apiKey
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
      forms[scope].secret = config.secret
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

function randomHex(byteLength: number) {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function generateSecurityEntry() {
  if (!canManageSecurityEntry.value || securityEntryLoading.value) return
  securityEntryInput.value = randomHex(24)
  showToast('已填入随机安全入口，尚未保存')
}

function generateGameApiKey() {
  if (!canEditGameApiKey.value || gameApiKeyLoading.value) return
  gameApiKey.value = randomHex(32)
  showGameApiKey.value = true
  showToast('已填入随机游戏 API 密钥，尚未保存')
}

function generateInboundMailKey() {
  if (!canEditInboundMailKey.value || inboundMailKeyLoading.value) return
  inboundMailKey.value = randomHex(32)
  showInboundMailKey.value = true
  showToast('已填入随机投递密钥，尚未保存')
}
</script>

<template>
<div class="page settings-page api-redesign-page">
    <header class="settings-header">
      <div class="settings-title-block">
        <h1 class="page-title">站点设置</h1>
      </div>
      <span class="settings-access-badge">
        <md-icon>{{ canEditPage ? 'edit' : 'visibility' }}</md-icon>
        {{ canEditPage ? '可编辑设置' : '只读设置' }}
      </span>
    </header>

    <div class="settings-sections">

    <section v-if="canManageSecurityEntry" class="card settings-card">
      <h2 class="card-title">后台安全入口</h2>
      <p class="card-note">当前入口：<code>/{{ currentSecurityEntry || '…' }}</code></p>
      <div class="setting-form">
        <div class="password-field">
          <md-outlined-text-field
            label="安全入口"
            supporting-text="12 至 64 位字母、数字、下划线或连字符"
            autocomplete="off"
            spellcheck="false"
            :disabled="securityEntryLoading"
            :value="securityEntryInput"
            @input="securityEntryInput = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
          <div class="secret-field-actions">
            <md-icon-button
              aria-label="生成随机安全入口"
              title="生成随机安全入口"
              :disabled="securityEntryLoading || savingSecurityEntry"
              @click="generateSecurityEntry"
            >
              <md-icon>casino</md-icon>
            </md-icon-button>
          </div>
        </div>
        <div class="form-actions">
          <md-filled-button :disabled="securityEntryLoading || savingSecurityEntry" @click="saveSecurityEntry">
            {{ savingSecurityEntry ? '保存中…' : '保存安全入口' }}
          </md-filled-button>
        </div>
      </div>
    </section>

    <section class="card settings-card">
      <h2 class="card-title">后台账户密码策略</h2>
      <p class="card-note">仅应用于后台账户的新建、修改和重置密码，不会影响游戏账户，也不会要求现有后台账户立即改密。</p>

      <div class="setting-form password-policy-form">
        <div class="password-policy-switch-row">
          <div>
            <strong>要求后台密码遵循复杂度原则</strong>
          </div>
          <md-switch
            :selected="passwordPolicyForm.enabled"
            :disabled="passwordPolicyLoading || !canEditPage"
            aria-label="要求后台账户密码遵循复杂度原则"
            @change="onPasswordPolicyToggle"
          ></md-switch>
        </div>

        <div class="password-policy-level">
          <div class="password-policy-level-heading">
            <span>最低复杂度</span>
            <strong>{{ passwordPolicyMinimumLabel }}</strong>
          </div>
          <md-slider
            min="1"
            max="6"
            step="1"
            ticks
            aria-label="后台账户最低密码复杂度"
            :value="passwordPolicyForm.minimumScore"
            :disabled="passwordPolicyLoading || !canEditPage"
            @input="onPasswordPolicyScoreInput"
          ></md-slider>
          <div class="password-policy-scale" aria-hidden="true">
            <span>基础</span>
            <span>一般</span>
            <span>中等</span>
            <span>良好</span>
            <span>强</span>
            <span>严格</span>
          </div>
        </div>

        <dl class="password-policy-details">
          <div>
            <dt>当前要求</dt>
            <dd>{{ passwordPolicyCurrentRequirements }}</dd>
          </div>
        </dl>

        <div v-if="canEditPage" class="form-actions">
          <md-filled-button :disabled="passwordPolicyLoading || savingPasswordPolicy" @click="savePasswordPolicy">
            {{ savingPasswordPolicy ? '保存中…' : '保存后台密码策略' }}
          </md-filled-button>
        </div>
      </div>
    </section>

    <section v-if="canManagePasswordExpiry" class="card settings-card">
      <h2 class="card-title">后台密码有效期</h2>
      <p class="card-note">启用后，后台账户会在密码到期前 10 天收到提醒；到期后必须更新密码才能继续操作后台。</p>

      <div class="setting-form password-policy-form">
        <div class="password-policy-switch-row">
          <div>
            <strong>要求后台密码定期更新</strong>
          </div>
          <md-switch
            :selected="passwordExpiryForm.enabled"
            :disabled="passwordExpiryLoading"
            aria-label="要求后台账户密码定期更新"
            @change="onPasswordExpiryToggle"
          ></md-switch>
        </div>

        <md-outlined-text-field
          type="number"
          label="密码有效期"
          supporting-text="1 至 3650 天"
          suffix-text="天"
          min="1"
          max="3650"
          step="1"
          :disabled="passwordExpiryLoading"
          :value="String(passwordExpiryForm.days)"
          @input="onPasswordExpiryDaysInput"
        ></md-outlined-text-field>

        <div class="form-actions">
          <md-filled-button :disabled="passwordExpiryLoading || savingPasswordExpiry" @click="savePasswordExpiry">
            {{ savingPasswordExpiry ? '保存中…' : '保存密码有效期' }}
          </md-filled-button>
        </div>
      </div>
    </section>

    <section v-if="canViewGameApiKey" class="card settings-card">
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
          <div class="secret-field-actions">
              <md-icon-button
                v-if="canEditGameApiKey"
                aria-label="生成随机游戏 API 密钥"
                title="生成随机游戏 API 密钥"
                :disabled="gameApiKeyLoading || savingGameApiKey"
                @click="generateGameApiKey"
              >
                <md-icon>casino</md-icon>
              </md-icon-button>
              <md-icon-button
                :aria-label="showGameApiKey ? '隐藏游戏 API 密钥' : '显示游戏 API 密钥'"
                :title="showGameApiKey ? '隐藏游戏 API 密钥' : '显示游戏 API 密钥'"
                :disabled="gameApiKeyLoading"
                @click="showGameApiKey = !showGameApiKey"
              >
                <md-icon>{{ showGameApiKey ? 'visibility_off' : 'visibility' }}</md-icon>
              </md-icon-button>
          </div>
        </div>
        <div v-if="canEditGameApiKey" class="form-actions">
          <md-filled-button :disabled="gameApiKeyLoading || savingGameApiKey" @click="saveGameApiKey">
            {{ savingGameApiKey ? '保存中…' : '保存游戏 API 密钥' }}
          </md-filled-button>
        </div>
      </div>
    </section>

    <section v-if="canViewInboundMailKey" class="card settings-card">
      <h2 class="card-title">域名邮件投递密钥</h2>
      <p class="card-note">请勿与游戏 API 密钥复用。</p>

      <p v-if="!inboundMailKeyLoading && inboundMailKeySource === 'none'" class="inherit-warning">
        <md-icon>warning</md-icon>
        <span>尚未配置，收件投递接口会返回 503，「域名邮件」页会一直是空的。</span>
      </p>
      <p v-else-if="!inboundMailKeyLoading && inboundMailKeySource === 'env'" class="source-note">
        <md-icon>info</md-icon>
        <span>
          当前使用环境变量 <code>YZWC_INBOUND_MAIL_KEY</code>。在此保存后改用数据库值。
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
          <div class="secret-field-actions">
              <md-icon-button
                v-if="canEditInboundMailKey"
                aria-label="生成随机域名邮件投递密钥"
                title="生成随机域名邮件投递密钥"
                :disabled="inboundMailKeyLoading || savingInboundMailKey"
                @click="generateInboundMailKey"
              >
                <md-icon>casino</md-icon>
              </md-icon-button>
              <md-icon-button
                :aria-label="showInboundMailKey ? '隐藏域名邮件投递密钥' : '显示域名邮件投递密钥'"
                :title="showInboundMailKey ? '隐藏域名邮件投递密钥' : '显示域名邮件投递密钥'"
                :disabled="inboundMailKeyLoading"
                @click="showInboundMailKey = !showInboundMailKey"
              >
                <md-icon>{{ showInboundMailKey ? 'visibility_off' : 'visibility' }}</md-icon>
              </md-icon-button>
          </div>
        </div>
        <div v-if="canEditInboundMailKey" class="form-actions">
          <md-filled-button :disabled="inboundMailKeyLoading || savingInboundMailKey" @click="saveInboundMailKey">
            {{ savingInboundMailKey ? '保存中…' : '保存投递密钥' }}
          </md-filled-button>
        </div>
        <p v-if="canEditInboundMailKey" class="card-note">
          保存后需在 Worker 执行 <code>npx wrangler secret put INBOUND_MAIL_KEY</code> 并填入相同值；不一致会拒收（401）。
        </p>
      </div>
    </section>

    <section v-if="canViewMcsm" class="card settings-card">
      <h2 class="card-title">MCSManager 面板</h2>
      <p class="card-note">ApiKey 权限与面板账户完全一致，请当作密码保管。</p>

      <p v-if="!mcsmLoading && !mcsmState?.configured" class="inherit-warning">
        <md-icon>warning</md-icon>
        <span>尚未配置，「服务器管理」页会一直提示去这里填写。</span>
      </p>
      <p v-else-if="!mcsmLoading && mcsmState?.apiKeySource === 'env'" class="source-note">
        <md-icon>info</md-icon>
        <span>
          当前使用环境变量 <code>YZWC_MCSM_API_KEY</code>。在此保存后改用数据库值。
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
            :supporting-text="mcsmState?.apiKeyConfigured ? '已配置，可直接查看或修改；留空表示沿用' : '尚未配置，必须填写'"
            autocomplete="new-password"
            spellcheck="false"
            :disabled="mcsmLoading"
            :readonly="!canEditMcsm"
            :value="mcsmForm.apiKey"
            @input="mcsmForm.apiKey = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
          <div class="secret-field-actions">
              <md-icon-button
                :aria-label="showMcsmApiKey ? '隐藏 ApiKey' : '显示 ApiKey'"
                :title="showMcsmApiKey ? '隐藏 ApiKey' : '显示 ApiKey'"
                :disabled="mcsmLoading"
                @click="showMcsmApiKey = !showMcsmApiKey"
              >
                <md-icon>{{ showMcsmApiKey ? 'visibility_off' : 'visibility' }}</md-icon>
              </md-icon-button>
          </div>
        </div>

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
    </section>

    <section v-if="canViewAdminTurnstile" class="card settings-card">
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
            :supporting-text="state.admin.secretConfigured ? '已配置，可直接查看或修改' : '尚未配置，必须填写'"
            autocomplete="new-password"
            spellcheck="false"
            :value="forms.admin.secret"
            :readonly="!canEditAdminTurnstile"
            @input="forms.admin.secret = ($event.target as HTMLInputElement).value"
          ></md-outlined-text-field>
          <div class="secret-field-actions">
              <md-icon-button
                :aria-label="showSecret.admin ? '隐藏服务端密钥' : '显示服务端密钥'"
                :title="showSecret.admin ? '隐藏服务端密钥' : '显示服务端密钥'"
                :disabled="loading"
                @click="showSecret.admin = !showSecret.admin"
              >
                <md-icon>{{ showSecret.admin ? 'visibility_off' : 'visibility' }}</md-icon>
              </md-icon-button>
          </div>
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
    </section>

    <section v-if="canViewChatTurnstile" class="card settings-card">
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
          <div class="secret-field-actions">
              <md-icon-button
                :aria-label="showSecret.chat ? '隐藏服务端密钥' : '显示服务端密钥'"
                :title="showSecret.chat ? '隐藏服务端密钥' : '显示服务端密钥'"
                :disabled="loading"
                @click="showSecret.chat = !showSecret.chat"
              >
                <md-icon>{{ showSecret.chat ? 'visibility_off' : 'visibility' }}</md-icon>
              </md-icon-button>
          </div>
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
    </section>

    <section class="card settings-card">
      <h2 class="card-title">服务器状态历史</h2>
      <p class="card-note">后台每次读取状态时会将 Worker 的监控样本保存到 API 服务端数据库，可长期保留。清除后不会重新导入清除时点之前的样本，新产生的状态仍会继续保存。</p>
      <dl class="password-policy-details status-history-details">
        <div>
          <dt>记录数量</dt>
          <dd>{{ statusHistoryLoading ? '加载中…' : statusHistoryStats.count }}</dd>
        </div>
        <div>
          <dt>最早记录</dt>
          <dd>{{ statusHistoryLoading ? '加载中…' : formatStatusHistoryTime(statusHistoryStats.oldestAt) }}</dd>
        </div>
        <div>
          <dt>最近记录</dt>
          <dd>{{ statusHistoryLoading ? '加载中…' : formatStatusHistoryTime(statusHistoryStats.latestAt) }}</dd>
        </div>
      </dl>
      <div v-if="canEditPage" class="form-actions">
        <md-filled-button
          :disabled="statusHistoryLoading || statusHistoryClearing || !statusHistoryStats.count"
          @click="clearStatusHistoryData"
        >
          <md-icon slot="icon">delete_sweep</md-icon>
          {{ statusHistoryClearing ? '清除中…' : '清除历史状态数据' }}
        </md-filled-button>
      </div>
    </section>

    </div>
  </div>
</template>

<style scoped>
.settings-page {
  width: min(100%, 1200px);
}

.settings-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.settings-title-block {
  min-width: 0;
}

.settings-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--md-sys-color-primary);
  font-size: 11px;
  font-weight: 700;
}

.settings-eyebrow md-icon {
  --md-icon-size: 16px;
}

.settings-title-block .page-title {
  margin: 0 0 4px;
}

.settings-title-block p {
  max-width: 620px;
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
}

.settings-access-badge {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 0 9px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 5px;
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface-container);
  font-size: 10px;
  font-weight: 700;
}

.settings-access-badge md-icon {
  --md-icon-size: 16px;
  color: var(--md-sys-color-primary);
}

.settings-sections {
  min-width: 0;
  column-count: 2;
  column-gap: 14px;
  column-fill: balance;
}

.settings-card {
  min-width: 0;
  width: 100% !important;
  display: inline-block;
  margin: 0 0 14px !important;
  vertical-align: top;
  break-inside: avoid;
  border: 1px solid var(--md-sys-color-outline-variant);
  box-shadow: var(--md-sys-elevation-level1);
}

.settings-card .card-title {
  margin-bottom: 0;
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
  background: color-mix(in srgb, var(--md-sys-color-error) 10%, transparent);
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

.settings-card .setting-form {
  width: 100%;
  max-width: none;
}

.password-policy-form {
  gap: 18px;
}

.password-policy-switch-row {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.password-policy-switch-row > div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.password-policy-switch-row strong,
.password-policy-level-heading strong {
  font-size: 14px;
  font-weight: 600;
}

.password-policy-switch-row span,
.password-policy-level-heading span,
.password-policy-scale {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
  line-height: 1.5;
}

.password-policy-switch-row md-switch {
  flex: 0 0 auto;
}

.password-policy-level {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.password-policy-level-heading,
.password-policy-scale {
  align-items: center;
}

.password-policy-level-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.password-policy-level-heading strong {
  color: var(--md-sys-color-primary);
}

.password-policy-level md-slider {
  width: 100%;
}

.password-policy-scale {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  padding: 0 8px;
  text-align: center;
}

.password-policy-details {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-top: 14px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
}

.password-policy-details > div {
  min-width: 0;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px;
  font-size: 12px;
  line-height: 1.6;
}

.password-policy-details dt {
  color: var(--md-sys-color-on-surface-variant);
}

.password-policy-details dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--md-sys-color-on-surface);
}

.setting-form md-outlined-text-field {
  width: 100%;
}

.password-field {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.password-field md-outlined-text-field {
  flex: 1;
  min-width: 0;
}

.secret-field-actions {
  min-height: var(--app-field-height);
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}

.secret-field-actions md-icon-button {
  flex: 0 0 auto;
}

.form-actions {
  display: flex;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 12px;
}

@media (max-width: 860px) {
  .settings-sections {
    column-count: 1;
  }

  .settings-card {
    display: block;
  }
}

@media (max-width: 640px) {
  .settings-header {
    align-items: stretch;
    flex-direction: column;
    gap: 16px;
  }

  .settings-access-badge {
    align-self: flex-start;
  }

  .setting-form {
    max-width: none;
  }

  .form-actions md-filled-button {
    width: 100%;
  }
}
</style>
