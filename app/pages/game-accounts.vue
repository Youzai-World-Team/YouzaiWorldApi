<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

useHead({ title: '游戏账户' })

interface GameAccount {
  username: string
  uuid: string | null
  last_login_ip: string
  last_authenticated_date: string
  login_tries: number
  registered: boolean
}

interface GameAccountSettings {
  loginCooldown: number
}

const accounts = ref<GameAccount[]>([])
const settings = ref<GameAccountSettings>({ loginCooldown: 300 })
const loading = ref(false)
const savingSettings = ref(false)
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
const { showToast } = useToast()
const { apply: applyDialogAnimation } = useDialogAnimation()
let uuidRequestId = 0

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
  deleteTarget.value = account
}

async function confirmDeleteAccount() {
  const account = deleteTarget.value
  if (!account || deletingAccount.value) return
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
  settings.value.loginCooldown = Math.min(86400, Math.max(-1, Math.trunc(settings.value.loginCooldown)))
  savingSettings.value = true
  try {
    settings.value = await $fetch<GameAccountSettings>('/api/admin/game-account-settings', {
      method: 'PATCH', body: settings.value,
    })
    showToast('登录冷却设置已保存')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '设置保存失败', 'error')
  } finally {
    savingSettings.value = false
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

onMounted(() => {
  loadAccounts()
  applyDialogAnimation(createDialog.value)
  applyDialogAnimation(resetDialog.value)
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
        <md-filled-button @click="showCreate = true"><md-icon slot="icon">person_add</md-icon>新建账户</md-filled-button>
      </div>
    </div>

    <div class="settings-grid">
      <div class="card setting-card">
        <h2>登录失败冷却</h2>
        <md-outlined-text-field type="number" min="-1" max="86400" step="1" label="冷却时间（秒）" :value="String(settings.loginCooldown)" @input="settings.loginCooldown = Math.min(86400, Math.max(-1, Math.trunc(Number(($event.target as HTMLInputElement).value) || 0)))"></md-outlined-text-field>
        <div class="setting-action">
          <md-filled-button :disabled="savingSettings" @click="saveSettings">
            {{ savingSettings ? '保存中…' : '保存冷却设置' }}
          </md-filled-button>
        </div>
      </div>
    </div>

    <div class="card table-card">
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="!accounts.length" class="empty">暂无游戏账户</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr><th>玩家代号</th><th>UUID</th><th>状态</th><th>最后登录 IP</th><th>最后认证</th><th>失败次数</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="account in accounts" :key="account.username">
              <td class="name">{{ account.username }}</td>
              <td class="mono">{{ account.uuid || '未绑定' }}</td>
              <td><span class="status" :class="account.registered ? 'status--ok' : 'status--pending'">{{ account.registered ? '已注册' : '未注册' }}</span></td>
              <td class="mono">{{ account.last_login_ip || '暂无记录' }}</td>
              <td>{{ formatAuthenticationDate(account.last_authenticated_date) }}</td>
              <td>{{ account.login_tries }}</td>
              <td class="actions"><md-icon-button aria-label="解除登录锁定" :disabled="account.login_tries < 5" @click="unlockAccount(account)"><md-icon>lock_open</md-icon></md-icon-button><md-icon-button aria-label="重置密码" @click="resetTarget = account"><md-icon>key</md-icon></md-icon-button><md-icon-button aria-label="注销账户" @click="deleteAccount(account)"><md-icon>delete</md-icon></md-icon-button></td>
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
  grid-template-columns: minmax(280px, 480px);
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

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.status {
  display: inline-flex;
  padding: 4px 8px;
  border-radius: 8px;
  font-size: 12px;
}

.status--ok {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.status--pending {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
}

.actions {
  text-align: right;
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: min(420px, calc(100vw - 72px));
}

.dialog-form md-outlined-text-field {
  width: 100%;
}

.dialog-form p {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
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

  .setting-action,
  .setting-action md-filled-button {
    width: 100%;
  }

  .table-card {
    margin: 0;
  }

  th,
  td {
    padding: 12px;
  }
}
</style>
