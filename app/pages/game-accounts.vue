<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

useHead({ title: '游戏账户' })

const access = useAdminAccess()
const canEditPage = computed(() => access.levelForKey('game-accounts') === 'edit')
const canManageAccounts = computed(() => canEditPage.value && access.featureLevelForKey('game-accounts-manage') === 'edit')
const canEditSettings = computed(() => canEditPage.value && access.featureLevelForKey('game-accounts-settings') === 'edit')
const canEditTemplates = computed(() => canEditPage.value && access.featureLevelForKey('game-accounts-email-templates') === 'edit')

interface GameAccount {
  username: string
  uuid: string | null
  email: string | null
  last_login_ip: string
  last_authenticated_date: string
  last_kicked_date: string
  login_tries: number
}

interface GameAccountSettings {
  loginCooldown: number
  emailVerificationRequired: boolean
  smtpConfigured: boolean
  smtp: {
    host: string
    port: number
    security: 'none' | 'starttls' | 'tls'
    username: string
    fromAddress: string
    fromName: string
    passwordConfigured: boolean
  }
}

const accounts = ref<GameAccount[]>([])
const settings = ref<GameAccountSettings>({
  loginCooldown: 300,
  emailVerificationRequired: false,
  smtpConfigured: false,
  smtp: {
    host: '',
    port: 587,
    security: 'starttls',
    username: '',
    fromAddress: '',
    fromName: '悠哉世界',
    passwordConfigured: false,
  },
})
const loading = ref(false)
const savingSettings = ref(false)
const savingEmailSettings = ref(false)
const showSmtpSettings = ref(false)
const enableEmailVerificationAfterSave = ref(false)
const smtpHost = ref('')
const smtpPort = ref(587)
const smtpSecurity = ref<'none' | 'starttls' | 'tls'>('starttls')
const smtpUsername = ref('')
const smtpPassword = ref('')
const smtpFromAddress = ref('')
const smtpFromName = ref('悠哉世界')
const showCreate = ref(false)
const username = ref('')
const password = ref('')
const uuid = ref('')
const resetTarget = ref<GameAccount | null>(null)
const resetPassword = ref('')
const deleteTarget = ref<GameAccount | null>(null)
const deletingAccount = ref(false)
const createDialog = ref<HTMLElement | null>(null)
const resetDialog = ref<HTMLElement | null>(null)
const smtpDialog = ref<HTMLElement | null>(null)
const { showToast } = useToast()
const { apply: applyDialogAnimation } = useDialogAnimation()
let uuidRequestId = 0
const lockClock = ref(Date.now())
let lockClockTimer: ReturnType<typeof setInterval> | null = null

watch(username, async (value) => {
  const name = value.trim()
  const requestId = ++uuidRequestId
  uuid.value = ''
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return

  try {
    const result = await $fetch<{ uuid: string }>('/api/admin/game-account-uuid', {
      query: { username: name },
    })
    if (requestId === uuidRequestId && username.value.trim() === name) uuid.value = result.uuid
  } catch {
    // 创建接口仍会在服务端生成 UUID；预览失败时不阻止管理员提交。
  }
})

async function loadAccounts() {
  loading.value = true
  try {
    const [items, currentSettings] = await Promise.all([
      $fetch<GameAccount[]>('/api/admin/game-accounts'),
      $fetch<GameAccountSettings>('/api/admin/game-account-settings'),
    ])
    accounts.value = items
    settings.value = currentSettings
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '账户加载失败', 'error')
  } finally {
    loading.value = false
  }
}

async function createAccount() {
  if (!canManageAccounts.value) return
  if (!/^[A-Za-z0-9_]{1,16}$/.test(username.value.trim()) || password.value.length < 4 || password.value.length > 128) {
    showToast('请输入玩家代号和 4 至 128 位密码', 'error')
    return
  }
  try {
    await $fetch('/api/admin/game-accounts', {
      method: 'POST',
      body: { username: username.value, password: password.value },
    })
    showToast('账户已创建')
    username.value = ''
    password.value = ''
    uuid.value = ''
    showCreate.value = false
    await loadAccounts()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '创建失败', 'error')
  }
}

async function resetAccountPassword() {
  if (!canManageAccounts.value) return
  if (!resetTarget.value) return
  if (resetPassword.value.length < 4 || resetPassword.value.length > 128) {
    showToast('密码需要为 4 至 128 位', 'error')
    return
  }
  try {
    await $fetch(`/api/admin/game-accounts/${encodeURIComponent(resetTarget.value.username)}`, {
      method: 'PATCH', body: { password: resetPassword.value },
    })
    showToast('密码已重置')
    resetTarget.value = null
    resetPassword.value = ''
    await loadAccounts()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '重置失败', 'error')
  }
}

function deleteAccount(account: GameAccount) {
  if (!canManageAccounts.value) return
  deleteTarget.value = account
}

/** 跳到「账户装扮」页并直接打开该账户的皮肤 / 披风详情。 */
function openCosmetics(account: GameAccount) {
  navigateTo({ path: '/game-cosmetics', query: { username: account.username } })
}

async function confirmDeleteAccount() {
  const account = deleteTarget.value
  if (!canManageAccounts.value || !account || deletingAccount.value) return
  deletingAccount.value = true
  try {
    await $fetch(`/api/admin/game-accounts/${encodeURIComponent(account.username)}`, { method: 'DELETE' })
    showToast('账户已注销')
    deleteTarget.value = null
    await loadAccounts()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '注销失败', 'error')
  } finally {
    deletingAccount.value = false
  }
}

async function unlockAccount(account: GameAccount) {
  if (!canManageAccounts.value) return
  try {
    await $fetch(`/api/admin/game-accounts/${encodeURIComponent(account.username)}`, {
      method: 'PATCH', body: { unlock: true },
    })
    showToast('登录锁定已解除')
    await loadAccounts()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '解锁失败', 'error')
  }
}

async function saveSettings() {
  if (!canEditSettings.value) return
  settings.value.loginCooldown = Math.min(86400, Math.max(-1, Math.trunc(settings.value.loginCooldown)))
  savingSettings.value = true
  try {
    settings.value = await $fetch<GameAccountSettings>('/api/admin/game-account-settings', {
      method: 'PATCH', body: { loginCooldown: settings.value.loginCooldown },
    })
    showToast('登录冷却设置已保存')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '设置保存失败', 'error')
  } finally {
    savingSettings.value = false
  }
}

function fillSmtpForm() {
  const smtp = settings.value.smtp
  smtpHost.value = smtp.host
  smtpPort.value = smtp.port
  smtpSecurity.value = smtp.security
  smtpUsername.value = smtp.username
  smtpPassword.value = ''
  smtpFromAddress.value = smtp.fromAddress
  smtpFromName.value = smtp.fromName || '悠哉世界'
}

function openSmtpDialog(enableAfterSave = false) {
  if (!canEditSettings.value) return
  fillSmtpForm()
  enableEmailVerificationAfterSave.value = enableAfterSave
  showSmtpSettings.value = true
}

function closeSmtpDialog() {
  showSmtpSettings.value = false
  enableEmailVerificationAfterSave.value = false
  smtpPassword.value = ''
}

function onSmtpSecurityChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'none' || value === 'starttls' || value === 'tls') smtpSecurity.value = value
}

async function onEmailVerificationChange(event: Event) {
  const checkbox = event.target as HTMLInputElement
  const requested = checkbox.checked
  checkbox.checked = settings.value.emailVerificationRequired
  if (!canEditSettings.value) return
  if (requested) {
    openSmtpDialog(true)
    return
  }
  savingEmailSettings.value = true
  try {
    settings.value = await $fetch<GameAccountSettings>('/api/admin/game-account-settings', {
      method: 'PATCH',
      body: { emailVerificationRequired: false },
    })
    showToast('注册邮箱验证已关闭')
  } catch (e: any) {
    showToast(e?.data?.message || e?.data?.statusMessage || '邮箱验证设置保存失败', 'error')
  } finally {
    savingEmailSettings.value = false
  }
}

async function saveSmtpSettings() {
  if (!canEditSettings.value) return
  const host = smtpHost.value.trim()
  const fromAddress = smtpFromAddress.value.trim()
  const username = smtpUsername.value.trim()
  const port = Math.trunc(Number(smtpPort.value))
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
    showToast('请填写有效的 SMTP 服务器、端口和发件邮箱', 'error')
    return
  }
  if (username && !smtpPassword.value
      && (!settings.value.smtp.passwordConfigured || username !== settings.value.smtp.username)) {
    showToast('首次配置或更换 SMTP 用户名时必须填写密码', 'error')
    return
  }
  if (!username && smtpPassword.value) {
    showToast('填写 SMTP 密码时必须同时填写用户名', 'error')
    return
  }
  if (smtpSecurity.value === 'none' && username) {
    showToast('使用 SMTP 认证时必须选择 STARTTLS 或 TLS', 'error')
    return
  }

  savingEmailSettings.value = true
  try {
    settings.value = await $fetch<GameAccountSettings>('/api/admin/game-account-settings', {
      method: 'PATCH',
      body: {
        emailVerificationRequired: enableEmailVerificationAfterSave.value
          ? true
          : settings.value.emailVerificationRequired,
        smtp: {
          host,
          port,
          security: smtpSecurity.value,
          username,
          password: smtpPassword.value || undefined,
          fromAddress,
          fromName: smtpFromName.value.trim() || '悠哉世界',
        },
      },
    })
    showToast(enableEmailVerificationAfterSave.value ? 'SMTP 已配置，注册邮箱验证已启用' : 'SMTP 配置已保存')
    closeSmtpDialog()
  } catch (e: any) {
    showToast(e?.data?.message || e?.data?.statusMessage || 'SMTP 配置保存失败', 'error')
  } finally {
    savingEmailSettings.value = false
  }
}

function formatAuthenticationDate(value: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || timestamp <= 1000) return '从未认证'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(timestamp))
}

function isAccountLocked(account: GameAccount) {
  const now = lockClock.value
  if (settings.value.loginCooldown === -1 || account.login_tries < 5) return false
  if (settings.value.loginCooldown === 0) return true
  const kickedAt = Date.parse(account.last_kicked_date)
  return Number.isFinite(kickedAt)
    && now - kickedAt < settings.value.loginCooldown * 1000
}

onMounted(() => {
  loadAccounts()
  lockClockTimer = window.setInterval(() => {
    lockClock.value = Date.now()
  }, 1000)
  applyDialogAnimation(createDialog.value)
  applyDialogAnimation(resetDialog.value)
  applyDialogAnimation(smtpDialog.value)
})

onUnmounted(() => {
  if (lockClockTimer !== null) window.clearInterval(lockClockTimer)
})
</script>

<template>
  <div class="page">
    <div class="page-heading">
      <div>
        <h1 class="page-title">游戏账户</h1>
      </div>
      <div class="heading-actions">
        <md-icon-button aria-label="刷新" :disabled="loading" @click="loadAccounts"><md-icon :class="{ 'refresh-icon--loading': loading }">refresh</md-icon></md-icon-button>
        <md-filled-button v-if="canManageAccounts" @click="showCreate = true"><md-icon slot="icon">person_add</md-icon>新建账户</md-filled-button>
      </div>
    </div>

    <div class="settings-grid">
      <div class="card setting-card">
        <h2>登录失败冷却</h2>
        <md-outlined-text-field type="number" min="-1" max="86400" step="1" label="冷却时间（秒）" :readonly="!canEditSettings" :value="String(settings.loginCooldown)" @input="settings.loginCooldown = Math.min(86400, Math.max(-1, Math.trunc(Number(($event.target as HTMLInputElement).value) || 0)))"></md-outlined-text-field>
        <div class="setting-action">
          <md-filled-button v-if="canEditSettings" :disabled="savingSettings" @click="saveSettings">
            {{ savingSettings ? '保存中…' : '保存冷却设置' }}
          </md-filled-button>
        </div>
      </div>

      <div class="card setting-card email-verification-card">
        <h2>注册验证</h2>
        <label class="email-verification-row">
          <md-checkbox
            :checked="settings.emailVerificationRequired"
            :disabled="loading || savingEmailSettings || !canEditSettings"
            @change="onEmailVerificationChange"
          ></md-checkbox>
          <span>
            <strong>注册需邮箱验证</strong>
          </span>
        </label>
        <div class="setting-action">
          <md-text-button v-if="canEditSettings" :disabled="loading || savingEmailSettings" @click="openSmtpDialog(false)">
            <md-icon slot="icon">mail</md-icon>
            配置 SMTP
          </md-text-button>
          <md-text-button :disabled="loading || savingEmailSettings" @click="navigateTo('/game-account-email-templates')">
            <md-icon slot="icon">edit_note</md-icon>
            {{ canEditTemplates ? '编辑邮件模板' : '查看邮件模板' }}
          </md-text-button>
        </div>
        <p class="smtp-status" :class="{ 'smtp-status--ready': settings.smtpConfigured }">
          {{ settings.smtpConfigured ? `SMTP 已配置：${settings.smtp.host}` : 'SMTP 尚未配置' }}
        </p>
      </div>
    </div>

    <div class="card table-card">
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="!accounts.length" class="empty">暂无游戏账户</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr><th>玩家代号</th><th class="uuid-column">UUID</th><th class="email-column">绑定邮箱</th><th>最后登录 IP</th><th>最后认证</th><th class="actions-column">操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="account in accounts" :key="account.username">
              <td class="name">
                <span class="account-name">
                  <span>{{ account.username }}</span>
                  <md-icon
                    v-if="isAccountLocked(account)"
                    class="account-lock-icon"
                    title="账户处于登录锁定状态"
                    aria-label="账户处于登录锁定状态"
                  >lock</md-icon>
                </span>
              </td>
              <td class="mono uuid-cell">{{ account.uuid || '未绑定' }}</td>
              <td class="mono email-cell" :title="account.email || undefined">{{ account.email || '未绑定' }}</td>
              <td class="mono">{{ account.last_login_ip || '暂无记录' }}</td>
              <td>{{ formatAuthenticationDate(account.last_authenticated_date) }}</td>
              <td class="actions"><md-icon-button v-if="canManageAccounts && isAccountLocked(account)" aria-label="解除登录锁定" title="解除登录锁定" @click="unlockAccount(account)"><md-icon>lock_open</md-icon></md-icon-button><md-icon-button aria-label="查看皮肤与披风" title="查看皮肤与披风" @click="openCosmetics(account)"><md-icon>checkroom</md-icon></md-icon-button><md-icon-button v-if="canManageAccounts" aria-label="重置密码" @click="resetTarget = account"><md-icon>key</md-icon></md-icon-button><md-icon-button v-if="canManageAccounts" aria-label="注销账户" @click="deleteAccount(account)"><md-icon>delete</md-icon></md-icon-button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <md-dialog ref="createDialog" :open="showCreate" @closed="showCreate = false">
      <div slot="headline">新建游戏账户</div>
      <div slot="content" class="dialog-form"><md-outlined-text-field label="玩家代号" :value="username" @input="username = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-outlined-text-field type="password" label="初始密码" :value="password" @input="password = ($event.target as HTMLInputElement).value"></md-outlined-text-field><md-outlined-text-field label="离线 UUID（自动生成）" :value="uuid || '输入玩家代号后自动生成'" readonly></md-outlined-text-field></div>
      <div slot="actions"><md-text-button @click="showCreate = false">取消</md-text-button><md-filled-button @click="createAccount">创建</md-filled-button></div>
    </md-dialog>

    <md-dialog ref="resetDialog" :open="!!resetTarget" @closed="resetTarget = null">
      <div slot="headline">重置密码</div>
      <div slot="content" class="dialog-form"><p>账户：{{ resetTarget?.username }}</p><md-outlined-text-field type="password" label="新密码" :value="resetPassword" @input="resetPassword = ($event.target as HTMLInputElement).value"></md-outlined-text-field></div>
      <div slot="actions"><md-text-button @click="resetTarget = null">取消</md-text-button><md-filled-button @click="resetAccountPassword">保存</md-filled-button></div>
    </md-dialog>

    <md-dialog ref="smtpDialog" :open="showSmtpSettings" @closed="closeSmtpDialog">
      <div slot="headline">配置 SMTP 服务器</div>
      <div slot="content" class="dialog-form smtp-form">
        <p v-if="enableEmailVerificationAfterSave">保存后将立即启用“注册需邮箱验证”。</p>
        <md-outlined-text-field
          label="SMTP 服务器"
          placeholder="smtp.example.com"
          :value="smtpHost"
          @input="smtpHost = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
        <div class="smtp-connection-row">
          <md-outlined-text-field
            type="number"
            min="1"
            max="65535"
            label="端口"
            :value="String(smtpPort)"
            @input="smtpPort = Math.trunc(Number(($event.target as HTMLInputElement).value) || 0)"
          ></md-outlined-text-field>
          <md-outlined-select label="连接安全" :value="smtpSecurity" @change="onSmtpSecurityChange">
            <md-select-option value="starttls"><div slot="headline">STARTTLS</div></md-select-option>
            <md-select-option value="tls"><div slot="headline">TLS / SSL</div></md-select-option>
            <md-select-option value="none"><div slot="headline">无加密</div></md-select-option>
          </md-outlined-select>
        </div>
        <md-outlined-text-field
          label="SMTP 用户名（无认证可留空）"
          autocomplete="off"
          :value="smtpUsername"
          @input="smtpUsername = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
        <md-outlined-text-field
          type="password"
          :label="settings.smtp.passwordConfigured ? 'SMTP 密码（留空保持不变）' : 'SMTP 密码'"
          autocomplete="new-password"
          :value="smtpPassword"
          @input="smtpPassword = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
        <md-outlined-text-field
          type="email"
          label="发件邮箱"
          :value="smtpFromAddress"
          @input="smtpFromAddress = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
        <md-outlined-text-field
          label="发件人名称"
          :value="smtpFromName"
          @input="smtpFromName = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
      </div>
      <div slot="actions">
        <md-text-button :disabled="savingEmailSettings" @click="closeSmtpDialog">取消</md-text-button>
        <md-filled-button :disabled="savingEmailSettings" @click="saveSmtpSettings">
          {{ savingEmailSettings ? '保存中…' : '保存配置' }}
        </md-filled-button>
      </div>
    </md-dialog>

    <ConfirmDialog
      :open="!!deleteTarget"
      title="注销游戏账户"
      :message="`确定要注销 ${deleteTarget?.username || ''} 吗？该账户关联的皮肤和披风也会一并删除。`"
      icon="person_remove"
      confirm-label="注销账户"
      pending-label="注销中…"
      destructive
      :pending="deletingAccount"
      @confirm="confirmDeleteAccount"
      @cancel="deleteTarget = null"
      @closed="deleteTarget = null"
    >
      <div v-if="deleteTarget" class="delete-account-preview">
        <md-icon>person</md-icon>
        <span>{{ deleteTarget.username }}</span>
      </div>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.page-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 20px;
}

.page-heading .page-title {
  margin: 0;
}

.heading-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.refresh-icon--loading {
  animation: refresh-spin 800ms linear infinite;
}

@keyframes refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.setting-card {
  padding: 20px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px 16px;
}

.setting-card h2 {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 17px;
}

.setting-action {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 4px;
}

.email-verification-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  cursor: pointer;
}

.email-verification-row > span {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.email-verification-row strong {
  font-size: 14px;
  font-weight: 500;
}

.smtp-status {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}

.smtp-status {
  grid-column: 1 / -1;
  margin: 0;
}

.smtp-status--ready {
  color: var(--act-success);
}

.table-card {
  padding: 0;
  overflow: hidden;
}

.empty {
  padding: 48px 20px;
  text-align: center;
  color: var(--md-sys-color-on-surface-variant);
}

table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
  font-size: 14px;
}

th,
td {
  text-align: left;
  padding: 14px 16px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  white-space: nowrap;
}

th {
  font-weight: 500;
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface-container-high);
}

tr:last-child td {
  border-bottom: 0;
}

.name {
  font-weight: 600;
}

.account-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.account-lock-icon {
  color: var(--act-error);
  font-size: 18px;
  font-variation-settings: 'FILL' 1;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.uuid-column,
.uuid-cell {
  width: 1%;
  padding-right: 8px;
}

.email-column,
.email-cell {
  padding-left: 8px;
}

.email-cell {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.actions-column,
.actions {
  width: 1%;
  padding-right: 8px;
  padding-left: 8px;
}

.actions {
  text-align: left;
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: min(420px, calc(100vw - 72px));
}

.dialog-form md-outlined-text-field,
.dialog-form md-outlined-select {
  width: 100%;
}

.dialog-form p {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
}

.smtp-connection-row {
  display: grid;
  grid-template-columns: minmax(120px, 0.7fr) minmax(180px, 1.3fr);
  gap: 12px;
}

.delete-account-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  font-weight: 600;
}

.delete-account-preview md-icon {
  color: var(--md-sys-color-on-surface-variant);
}

@media (max-width: 700px) {
  .page-heading {
    align-items: stretch;
  }

  .page-heading > div:first-child,
  .heading-actions {
    width: 100%;
  }

  .heading-actions md-filled-button {
    flex: 1;
  }

  .settings-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .setting-card {
    grid-template-columns: minmax(0, 1fr);
  }

  .setting-card h2 {
    grid-column: auto;
  }

  .email-verification-row,
  .smtp-status {
    grid-column: auto;
  }

  .setting-action,
  .setting-action md-filled-button {
    width: 100%;
  }

  .table-card {
    margin: 0;
  }

  .smtp-connection-row {
    grid-template-columns: minmax(0, 1fr);
  }

  th,
  td {
    padding: 12px;
  }
}
</style>
