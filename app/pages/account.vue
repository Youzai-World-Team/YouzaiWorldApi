<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const updating = ref(false)

const fileInput = ref<HTMLInputElement | null>(null)
const uploadingAvatar = ref(false)
const fullNameInput = ref('')
const savingFullName = ref(false)

const { showToast } = useToast()
const { load: loadEntry } = useEntry()
const access = useAdminAccess()
interface CurrentUser {
  username: string
  avatar: string
  fullName: string
  isOwner: boolean
}

interface AccountDevice {
  id: string
  device: string
  browser: string
  os: string
  ip: string
  location: string
  lastLoginAt: number
  loginCount: number
  isCurrent: boolean
  online: boolean
  lastSeenAt: number | null
}

interface AppInfo {
  version: string
  deployedAt: number
  contributors: string[]
  repository: {
    name: string
    url: string
  }
}

const currentUser = ref<CurrentUser | null>(null)
const devices = ref<AccountDevice[]>([])
const devicesLoading = ref(false)
const appInfo = ref<AppInfo | null>(null)
const appInfoLoading = ref(false)
const displayName = computed(() => currentUser.value?.fullName || currentUser.value?.username || '账户')
const canChangePassword = computed(() => access.featureLevelForKey('account-password') === 'edit')
const canChangeFullName = computed(() => access.featureLevelForKey('account-full-name') === 'edit')
const canChangeAvatar = computed(() => access.featureLevelForKey('account-avatar') === 'edit')
useHead({ title: '此账户' })

onMounted(async () => {
  try {
    const result = await $fetch<{ user: CurrentUser }>('/api/auth/me')
    currentUser.value = result.user
    access.updateProfile(result.user)
    fullNameInput.value = result.user.fullName || ''
  } catch {}
  await Promise.all([loadDevices(), loadAppInfo()])
})

function onInput(field: 'old' | 'new' | 'confirm', e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (field === 'old') oldPassword.value = v
  else if (field === 'new') newPassword.value = v
  else confirmPassword.value = v
}

async function updatePassword() {
  if (updating.value || !canChangePassword.value) return
  if (!newPassword.value || newPassword.value !== confirmPassword.value) {
    showToast('两次输入的新密码不一致', 'error')
    return
  }
  updating.value = true
  try {
    const entry = await loadEntry()
    await $fetch('/api/auth/password', {
      method: 'POST',
      body: { oldPassword: oldPassword.value, newPassword: newPassword.value }
    })
    await navigateTo('/' + entry)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '更新失败', 'error')
  } finally {
    updating.value = false
  }
}

function pickAvatar() {
  if (!canChangeAvatar.value) return
  fileInput.value?.click()
}

async function loadDevices() {
  if (devicesLoading.value) return
  devicesLoading.value = true
  try {
    devices.value = await $fetch<AccountDevice[]>('/api/auth/devices')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '登录设备加载失败', 'error')
  } finally {
    devicesLoading.value = false
  }
}

function formatDeviceClient(device: AccountDevice) {
  return [device.browser, device.os].filter(Boolean).join(' · ') || '未知客户端'
}

function formatDeviceTime(value: number | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '暂无记录'
}

async function loadAppInfo() {
  if (appInfoLoading.value) return
  appInfoLoading.value = true
  try {
    appInfo.value = await $fetch<AppInfo>('/api/auth/app-info')
  } catch {
    appInfo.value = null
  } finally {
    appInfoLoading.value = false
  }
}

async function saveFullName() {
  if (savingFullName.value || !canChangeFullName.value) return
  const fullName = fullNameInput.value.trim().replace(/\s+/g, ' ')
  if (fullName.length > 64) {
    showToast('全名不能超过 64 个字符', 'error')
    return
  }
  savingFullName.value = true
  try {
    const result = await $fetch<{ user: CurrentUser }>('/api/auth/full-name', {
      method: 'POST',
      body: { fullName },
    })
    currentUser.value = result.user
    fullNameInput.value = result.user.fullName
    window.dispatchEvent(new CustomEvent('admin-profile-updated', { detail: result.user }))
    showToast(fullName ? '全名已更新' : '已清除全名，将显示用户名')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '全名更新失败', 'error')
  } finally {
    savingFullName.value = false
  }
}

async function onAvatarChange(event: Event) {
  if (!canChangeAvatar.value) return
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件', 'error')
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast('头像图片不能超过 2 MiB', 'error')
    return
  }

  uploadingAvatar.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    form.append('purpose', 'account-avatar')
    const upload = await $fetch<{ url: string }>('/api/upload', { method: 'POST', body: form })
    const result = await $fetch<{ user: CurrentUser }>('/api/auth/avatar', {
      method: 'POST',
      body: { avatar: upload.url },
    })
    currentUser.value = result.user
    window.dispatchEvent(new CustomEvent('admin-profile-updated', { detail: result.user }))
    showToast('头像已更新')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '头像更新失败', 'error')
  } finally {
    uploadingAvatar.value = false
  }
}

async function clearAvatar() {
  if (uploadingAvatar.value || !canChangeAvatar.value) return
  uploadingAvatar.value = true
  try {
    const result = await $fetch<{ user: CurrentUser }>('/api/auth/avatar', {
      method: 'POST',
      body: { avatar: '' },
    })
    currentUser.value = result.user
    window.dispatchEvent(new CustomEvent('admin-profile-updated', { detail: result.user }))
    showToast('头像已移除')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '头像更新失败', 'error')
  } finally {
    uploadingAvatar.value = false
  }
}

async function restoreOwnerAvatar() {
  if (uploadingAvatar.value || !canChangeAvatar.value || !currentUser.value?.isOwner) return
  uploadingAvatar.value = true
  try {
    const result = await $fetch<{ user: CurrentUser }>('/api/auth/avatar', {
      method: 'POST',
      body: { avatar: '/favicon.ico' },
    })
    currentUser.value = result.user
    window.dispatchEvent(new CustomEvent('admin-profile-updated', { detail: result.user }))
    showToast('已恢复默认头像')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '头像更新失败', 'error')
  } finally {
    uploadingAvatar.value = false
  }
}

async function logout() {
  const entry = await loadEntry()
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
  } finally {
    await navigateTo('/' + entry)
  }
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">此账户</h1>

    <div class="account-stack">
    <section class="card account-card profile-card">
      <h2 class="card-title">个人资料</h2>
      <div class="profile-row">
        <div class="profile-avatar" role="img" :aria-label="`${currentUser?.username || '用户'}的头像`">
          <img v-if="currentUser?.avatar" :src="currentUser.avatar" alt="" />
          <md-icon v-else>account_circle</md-icon>
          <span v-if="uploadingAvatar" class="profile-avatar-loading">上传中…</span>
        </div>
        <div class="profile-info">
          <strong>{{ displayName }}</strong>
          <span v-if="currentUser?.fullName" class="profile-username">用户名：{{ currentUser.username }}</span>
          <div class="profile-actions">
            <md-text-button v-if="canChangeAvatar" :disabled="uploadingAvatar" @click="pickAvatar">
              <md-icon slot="icon">upload</md-icon>
              设置头像
            </md-text-button>
            <md-text-button v-if="canChangeAvatar && currentUser?.avatar && currentUser.isOwner && currentUser.avatar !== '/favicon.ico'" :disabled="uploadingAvatar" @click="restoreOwnerAvatar">
              <md-icon slot="icon">restore</md-icon>
              恢复默认
            </md-text-button>
            <md-text-button v-else-if="canChangeAvatar && currentUser?.avatar && !currentUser.isOwner" :disabled="uploadingAvatar" @click="clearAvatar">
              <md-icon slot="icon">delete</md-icon>
              移除头像
            </md-text-button>
          </div>
        </div>
      </div>
      <div v-if="canChangeFullName" class="full-name-form">
        <md-outlined-text-field
          label="全名"
          supporting-text="留空时显示用户名"
          maxlength="64"
          :value="fullNameInput"
          @input="fullNameInput = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
        <md-filled-button :disabled="savingFullName" @click="saveFullName">
          {{ savingFullName ? '保存中…' : '保存全名' }}
        </md-filled-button>
      </div>
      <input ref="fileInput" class="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" @change="onAvatarChange" />
    </section>

    <section v-if="canChangePassword" class="card account-card">
      <h2 class="card-title">更新密码</h2>
      <div class="form">
        <md-outlined-text-field
          type="password"
          label="当前密码"
          :value="oldPassword"
          @input="onInput('old', $event)"
        ></md-outlined-text-field>
        <md-outlined-text-field
          type="password"
          label="新密码"
          :value="newPassword"
          @input="onInput('new', $event)"
        ></md-outlined-text-field>
        <md-outlined-text-field
          type="password"
          label="确认新密码"
          :value="confirmPassword"
          @input="onInput('confirm', $event)"
        ></md-outlined-text-field>
        <md-filled-button :disabled="updating" @click="updatePassword">
          {{ updating ? '更新中…' : '更新密码' }}
        </md-filled-button>
      </div>
    </section>

    <section class="card account-card devices-card">
      <div class="card-heading-row">
        <div><h2 class="card-title">登录设备</h2><span>{{ devices.length }} 个设备记录</span></div>
        <md-icon-button aria-label="刷新登录设备" title="刷新" :disabled="devicesLoading" @click="loadDevices">
          <md-icon :class="{ 'refresh-icon--active': devicesLoading }">refresh</md-icon>
        </md-icon-button>
      </div>
      <div v-if="devicesLoading && !devices.length" class="devices-loading"><md-circular-progress indeterminate></md-circular-progress></div>
      <div v-else-if="devices.length" class="device-list">
        <article v-for="device in devices" :key="device.id" class="device-item">
          <span
            class="device-icon"
            :class="{ 'device-icon--current': device.isCurrent }"
          ><DeviceClientIcon :client="device" /></span>
          <div class="device-copy">
            <div class="device-title-row">
              <strong>{{ device.device || '未知设备' }}</strong>
              <span v-if="device.isCurrent" class="device-status device-status--current">当前设备</span>
              <span v-if="device.online" class="device-status device-status--online"><i></i>在线</span>
            </div>
            <span>{{ formatDeviceClient(device) }}</span>
            <div class="device-meta">
              <code>{{ device.ip || '未知 IP' }}</code>
              <span v-if="device.location" class="device-location"><md-icon>location_on</md-icon>{{ device.location }}</span>
              <span>登录 {{ device.loginCount }} 次</span>
            </div>
          </div>
          <time :datetime="new Date(device.lastLoginAt).toISOString()" :title="formatDeviceTime(device.lastSeenAt || device.lastLoginAt)">
            <span>{{ device.isCurrent ? '最近活动' : '最近登录' }}</span>
            <strong>{{ formatDeviceTime(device.lastSeenAt || device.lastLoginAt) }}</strong>
          </time>
        </article>
      </div>
      <div v-else class="devices-empty"><md-icon>devices</md-icon><span>暂无登录设备记录</span></div>
    </section>

    <section class="card account-card">
      <h2 class="card-title">账户操作</h2>
      <md-text-button class="logout-btn" @click="logout">
        <md-icon slot="icon">logout</md-icon>
        登出账户
      </md-text-button>
    </section>

    <section class="card account-card app-info-card">
      <div class="card-heading-row">
        <h2 class="card-title">关于YouzaiWorld API</h2>
        <md-icon-button aria-label="刷新服务端信息" title="刷新" :disabled="appInfoLoading" @click="loadAppInfo">
          <md-icon :class="{ 'refresh-icon--active': appInfoLoading }">refresh</md-icon>
        </md-icon-button>
      </div>
      <dl class="app-info-list">
        <div>
          <dt><md-icon>deployed_code</md-icon><span>版本</span></dt>
          <dd>{{ appInfo?.version || 'Beta 2.5.4' }}</dd>
        </div>
        <div>
          <dt><md-icon>schedule</md-icon><span>上一次部署</span></dt>
          <dd>{{ appInfo ? formatDeviceTime(appInfo.deployedAt) : (appInfoLoading ? '正在读取…' : '暂时无法获取') }}</dd>
        </div>
        <div>
          <dt><md-icon>group</md-icon><span>贡献者</span></dt>
          <dd>{{ appInfo?.contributors.join('、') || 'a彬彬a、Csituka_D' }}</dd>
        </div>
        <div>
          <dt><md-icon>code</md-icon><span>开源仓库</span></dt>
          <dd>
            <a
              :href="appInfo?.repository.url || 'https://github.com/Youzai-World-Team/YouzaiWorldApi'"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ appInfo?.repository.name || 'YouzaiWorldApi' }}
              <md-icon>open_in_new</md-icon>
            </a>
          </dd>
        </div>
      </dl>
    </section>
    </div>
  </div>
</template>

<style scoped>
.account-stack {
  width: min(100%, 520px);
  display: grid;
  gap: 20px;
}

.account-card {
  min-width: 0;
}

.profile-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.profile-avatar {
  position: relative;
  width: 88px;
  height: 88px;
  flex: 0 0 88px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface-container-high);
}

.profile-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-avatar md-icon {
  --md-icon-size: 44px;
}

.profile-avatar-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 12px;
  text-align: center;
  background: rgb(0 0 0 / 55%);
}

.profile-info {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.profile-info strong {
  overflow-wrap: anywhere;
}

.profile-username {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.profile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.hidden-input {
  display: none;
}

.full-name-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  margin-top: 20px;
}

.full-name-form md-outlined-text-field {
  width: 100%;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.logout-btn {
  color: var(--md-sys-color-error);
}

.card-heading-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.card-heading-row > div { min-width: 0; display: grid; gap: 3px; }
.card-heading-row .card-title { margin-bottom: 0; }
.card-heading-row span { color: var(--md-sys-color-on-surface-variant); font-size: 11px; }
.device-list { display: grid; margin-top: 16px; }
.device-item { min-width: 0; display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 13px 0; border-top: 1px solid var(--md-sys-color-outline-variant); }
.device-icon { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 8px; color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container-high); }
.device-icon md-icon { --md-icon-size: 21px; }
.device-icon--current { color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); }
.device-copy { min-width: 0; display: grid; gap: 5px; }
.device-title-row { min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.device-title-row strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.device-copy > span { overflow: hidden; color: var(--md-sys-color-on-surface-variant); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.device-status { display: inline-flex; align-items: center; gap: 4px; padding: 3px 6px; border-radius: 4px; font-size: 8px; font-weight: 700; }
.device-status--current { color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); }
.device-status--online { color: var(--act-success); background: color-mix(in srgb, var(--act-success) 10%, transparent); }
.device-status--online i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.device-meta { min-width: 0; display: flex; flex-wrap: wrap; gap: 8px; color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.device-meta code { font: 10px 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
.device-location { display: inline-flex; align-items: center; gap: 2px; }
.device-location md-icon { --md-icon-size: 12px; }
.device-item time { display: grid; justify-items: end; gap: 4px; white-space: nowrap; }
.device-item time span { color: var(--md-sys-color-on-surface-variant); font-size: 9px; }
.device-item time strong { font-size: 10px; font-weight: 600; }
.devices-loading, .devices-empty { min-height: 100px; display: grid; place-items: center; align-content: center; gap: 8px; color: var(--md-sys-color-on-surface-variant); font-size: 12px; }
.devices-empty md-icon { --md-icon-size: 28px; }
.app-info-list { display: grid; margin: 16px 0 0; }
.app-info-list > div { min-width: 0; display: grid; grid-template-columns: minmax(120px, 0.8fr) minmax(0, 1.2fr); align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid var(--md-sys-color-outline-variant); }
.app-info-list dt { display: flex; align-items: center; gap: 8px; color: var(--md-sys-color-on-surface-variant); font-size: 12px; }
.app-info-list dt md-icon { flex: 0 0 auto; --md-icon-size: 19px; }
.app-info-list dd { min-width: 0; margin: 0; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.app-info-list a { display: inline-flex; max-width: 100%; align-items: center; gap: 5px; color: var(--md-sys-color-primary); text-decoration: none; overflow-wrap: anywhere; }
.app-info-list a:hover { text-decoration: underline; }
.app-info-list a md-icon { flex: 0 0 auto; --md-icon-size: 16px; }
.refresh-icon--active { animation: device-refresh 900ms linear infinite; }
@keyframes device-refresh { to { transform: rotate(360deg); } }

@media (max-width: 480px) {
  .account-stack {
    gap: 12px;
  }

  .form md-filled-button {
    width: 100%;
  }

  .profile-row {
    align-items: flex-start;
  }

  .profile-actions {
    display: grid;
    justify-items: start;
  }

  .full-name-form {
    grid-template-columns: 1fr;
  }

  .full-name-form md-filled-button {
    width: 100%;
  }

  .device-item { grid-template-columns: 38px minmax(0, 1fr); }
  .device-item time { grid-column: 2; justify-items: start; }

  .app-info-list > div {
    grid-template-columns: minmax(0, 1fr);
    gap: 5px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .refresh-icon--active { animation: none; }
}
</style>
