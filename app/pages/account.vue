<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import {
  ADMIN_NAVIGATION_ORDER,
  ADMIN_PAGE_DEFINITIONS,
  normalizeAdminNavigationPreferences,
  type AdminNavigationPreferences,
  type AdminPagePermissionLevel,
} from '#shared/admin-page-permissions'
import type { PasswordExpiryStatus } from '#shared/password-policy'
import { WEB_ASSET_BASE_URL } from '#shared/web-assets'

const defaultOwnerAvatar = `${WEB_ASSET_BASE_URL}/favicon.ico`

const passwordDialogOpen = ref(false)

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
  passwordExpiry: PasswordExpiryStatus
  permissions: Record<string, AdminPagePermissionLevel>
  navigationPreferences: AdminNavigationPreferences
}

interface AccountNavigationItem {
  key: string
  label: string
  icon: string
  hidden: boolean
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
const navigationItems = ref<AccountNavigationItem[]>([])
const savingNavigation = ref(false)
const draggingNavigationKey = ref('')
const displayName = computed(() => currentUser.value?.fullName || currentUser.value?.username || '账户')
const visibleNavigationCount = computed(() => navigationItems.value.filter((item) => !item.hidden).length)
const canChangePassword = computed(() => (
  access.featureLevelForKey('account-password') === 'edit' || currentUser.value?.passwordExpiry.expired === true
))
const canChangeFullName = computed(() => access.featureLevelForKey('account-full-name') === 'edit')
const canChangeAvatar = computed(() => access.featureLevelForKey('account-avatar') === 'edit')
const passwordExpiryLabel = computed(() => {
  const status = currentUser.value?.passwordExpiry
  if (!status?.enabled) return ''
  if (status.expired) return '密码已过期'
  if ((status.daysRemaining ?? 0) <= 1) return '密码将在 1 天内过期'
  return `密码还有 ${status.daysRemaining} 天过期`
})
const passwordExpiryDate = computed(() => {
  const expiresAt = currentUser.value?.passwordExpiry.expiresAt
  return expiresAt ? new Date(expiresAt).toLocaleString('zh-CN') : ''
})
useHead({ title: '此账户' })

onMounted(async () => {
  try {
    const result = await $fetch<{ user: CurrentUser }>('/api/auth/me')
    currentUser.value = result.user
    access.updateProfile(result.user)
    fullNameInput.value = result.user.fullName || ''
    syncNavigationItems(result.user)
  } catch {}
  if (currentUser.value?.passwordExpiry.expired) return
  await Promise.all([loadDevices(), loadAppInfo()])
})

function syncNavigationItems(user: CurrentUser) {
  const preferences = normalizeAdminNavigationPreferences(user.navigationPreferences)
  const hidden = new Set(preferences.hidden)
  const pageMap = new Map(ADMIN_PAGE_DEFINITIONS.map((page) => [page.key, page]))
  const items: AccountNavigationItem[] = []
  for (const key of preferences.order) {
    const page = pageMap.get(key)
    if (!page || user.permissions[key] === 'hidden') continue
    items.push({ key, label: page.label, icon: page.icon, hidden: hidden.has(key) })
  }
  navigationItems.value = items
}

function moveNavigationItem(index: number, offset: -1 | 1) {
  const target = index + offset
  if (target < 0 || target >= navigationItems.value.length) return
  const items = [...navigationItems.value]
  const [item] = items.splice(index, 1)
  if (!item) return
  items.splice(target, 0, item)
  navigationItems.value = items
}

function setNavigationItemVisibility(key: string, event: Event) {
  const selected = Boolean((event.target as HTMLElement & { selected?: boolean }).selected)
  navigationItems.value = navigationItems.value.map((item) => (
    item.key === key ? { ...item, hidden: !selected } : item
  ))
}

function resetNavigationPreferences() {
  const user = currentUser.value
  if (!user) return
  const pageMap = new Map(ADMIN_PAGE_DEFINITIONS.map((page) => [page.key, page]))
  navigationItems.value = ADMIN_NAVIGATION_ORDER.flatMap((key) => {
    const page = pageMap.get(key)
    return page && user.permissions[key] !== 'hidden'
      ? [{ key, label: page.label, icon: page.icon, hidden: false }]
      : []
  })
}

function onNavigationDragStart(key: string, event: Event) {
  draggingNavigationKey.value = key
  const dataTransfer = (event as DragEvent).dataTransfer
  if (dataTransfer) {
    dataTransfer.effectAllowed = 'move'
    dataTransfer.setData('text/plain', key)
  }
}

function onNavigationDrop(targetKey: string) {
  const sourceKey = draggingNavigationKey.value
  draggingNavigationKey.value = ''
  if (!sourceKey || sourceKey === targetKey) return
  const items = [...navigationItems.value]
  const sourceIndex = items.findIndex((item) => item.key === sourceKey)
  const targetIndex = items.findIndex((item) => item.key === targetKey)
  if (sourceIndex < 0 || targetIndex < 0) return
  const [item] = items.splice(sourceIndex, 1)
  if (!item) return
  items.splice(targetIndex, 0, item)
  navigationItems.value = items
}

async function saveNavigationPreferences() {
  if (savingNavigation.value || !currentUser.value) return
  savingNavigation.value = true
  try {
    const result = await $fetch<{ user: CurrentUser }>('/api/auth/navigation', {
      method: 'POST',
      body: {
        order: navigationItems.value.map((item) => item.key),
        hidden: navigationItems.value.filter((item) => item.hidden).map((item) => item.key),
      },
    })
    currentUser.value = result.user
    syncNavigationItems(result.user)
    access.updateProfile(result.user)
    window.dispatchEvent(new CustomEvent('admin-profile-updated', { detail: result.user }))
    showToast('侧边栏偏好已保存')
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '侧边栏偏好保存失败', 'error')
  } finally {
    savingNavigation.value = false
  }
}

function openPasswordDialog() {
  if (!canChangePassword.value) return
  passwordDialogOpen.value = true
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
      body: { avatar: defaultOwnerAvatar },
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
<div class="page account-page api-redesign-page">
    <header class="account-header">
      <div class="account-title-block">
        <h1 class="page-title">此账户</h1>
      </div>
      <span v-if="currentUser" class="account-access-badge">
        <md-icon>{{ currentUser.isOwner ? 'verified_user' : 'person' }}</md-icon>
        {{ currentUser.isOwner ? '初始所有者' : '后台账户' }}
      </span>
    </header>

    <div class="account-layout">
      <div class="account-column account-column--left">
    <section class="card account-card account-card--profile profile-card">
      <div class="account-card-heading">
        <div>
          <span class="section-overline">个人信息</span>
          <h2 class="card-title">个人资料</h2>
        </div>
        <md-icon>badge</md-icon>
      </div>
      <div class="profile-row">
        <div class="profile-avatar" role="img" :aria-label="`${currentUser?.username || '用户'}的头像`">
          <img v-if="currentUser?.avatar" :src="currentUser.avatar" alt="" />
          <md-icon v-else>account_circle</md-icon>
          <span v-if="uploadingAvatar" class="profile-avatar-loading">上传中…</span>
        </div>
        <div class="profile-info">
          <strong>{{ displayName }}</strong>
          <span v-if="currentUser?.fullName" class="profile-username">用户名：{{ currentUser.username }}</span>
          <span v-else class="profile-username">用户名：{{ currentUser?.username || '正在读取…' }}</span>
          <span v-if="currentUser" class="profile-role">
            <md-icon>{{ currentUser.isOwner ? 'verified_user' : 'admin_panel_settings' }}</md-icon>
            {{ currentUser.isOwner ? '拥有全部后台权限' : '按分配的权限访问后台' }}
          </span>
          <div class="profile-actions">
            <md-text-button v-if="canChangeAvatar" :disabled="uploadingAvatar" @click="pickAvatar">
              <md-icon slot="icon">upload</md-icon>
              设置头像
            </md-text-button>
            <md-text-button v-if="canChangeAvatar && currentUser?.avatar && currentUser.isOwner && currentUser.avatar !== defaultOwnerAvatar" :disabled="uploadingAvatar" @click="restoreOwnerAvatar">
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

    <section class="card account-card account-card--operations">
      <div class="account-card-heading">
        <div>
          <span class="section-overline">安全与会话</span>
          <h2 class="card-title">账户操作</h2>
        </div>
        <md-icon>security</md-icon>
      </div>
      <div class="account-operation-actions">
        <md-text-button v-if="canChangePassword" @click="openPasswordDialog">
          <md-icon slot="icon">lock_reset</md-icon>
          更新密码
        </md-text-button>
        <md-text-button class="logout-btn" @click="logout">
          <md-icon slot="icon">logout</md-icon>
          登出账户
        </md-text-button>
      </div>
      <div
        v-if="currentUser?.passwordExpiry.enabled"
        class="password-expiry-status"
        :class="{
          'password-expiry-status--warning': currentUser.passwordExpiry.warning,
          'password-expiry-status--expired': currentUser.passwordExpiry.expired,
        }"
      >
        <md-icon>{{ currentUser.passwordExpiry.expired ? 'error' : 'schedule' }}</md-icon>
        <div>
          <strong>{{ passwordExpiryLabel }}</strong>
          <time
            v-if="currentUser.passwordExpiry.expiresAt"
            :datetime="new Date(currentUser.passwordExpiry.expiresAt).toISOString()"
          >
            到期时间：{{ passwordExpiryDate }}
          </time>
        </div>
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
      <EmptyState v-else class="devices-empty" compact image="/images/empty-monitoring-data.svg">
        暂无登录设备记录
      </EmptyState>
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

      <div class="account-column account-column--right">
        <section class="card account-card navigation-preferences-card">
          <div class="card-heading-row">
            <div>
              <h2 class="card-title">侧边栏</h2>
              <span>{{ visibleNavigationCount }} / {{ navigationItems.length }} 个条目显示</span>
            </div>
            <md-icon-button
              aria-label="恢复默认侧边栏"
              title="恢复默认排序和显示"
              :disabled="savingNavigation || !navigationItems.length"
              @click="resetNavigationPreferences"
            >
              <md-icon>restart_alt</md-icon>
            </md-icon-button>
          </div>

          <div v-if="navigationItems.length" class="navigation-preference-list">
            <article
              v-for="(item, index) in navigationItems"
              :key="item.key"
              class="navigation-preference-item"
              :class="{
                'navigation-preference-item--hidden': item.hidden,
                'navigation-preference-item--dragging': draggingNavigationKey === item.key,
              }"
              @dragover.prevent
              @drop.prevent="onNavigationDrop(item.key)"
            >
              <span
                class="navigation-drag-handle"
                draggable="true"
                title="拖动排序"
                @dragstart="onNavigationDragStart(item.key, $event)"
                @dragend="draggingNavigationKey = ''"
              >
                <md-icon>drag_indicator</md-icon>
              </span>
              <span class="navigation-preference-icon"><md-icon>{{ item.icon }}</md-icon></span>
              <strong>{{ item.label }}</strong>
              <div class="navigation-item-actions">
                <md-icon-button
                  :aria-label="`上移${item.label}`"
                  title="上移"
                  :disabled="index === 0"
                  @click="moveNavigationItem(index, -1)"
                >
                  <md-icon>arrow_upward</md-icon>
                </md-icon-button>
                <md-icon-button
                  :aria-label="`下移${item.label}`"
                  title="下移"
                  :disabled="index === navigationItems.length - 1"
                  @click="moveNavigationItem(index, 1)"
                >
                  <md-icon>arrow_downward</md-icon>
                </md-icon-button>
                <md-switch
                  :selected="!item.hidden"
                  :aria-label="`在侧边栏显示${item.label}`"
                  @change="setNavigationItemVisibility(item.key, $event)"
                ></md-switch>
              </div>
            </article>
          </div>
          <EmptyState v-else class="navigation-preference-empty" compact image="/images/empty-looking-for-answers.svg">
            暂无可配置的侧边栏条目
          </EmptyState>

          <div class="navigation-preference-actions">
            <md-filled-button
              :disabled="savingNavigation || !navigationItems.length"
              @click="saveNavigationPreferences"
            >
              <md-icon slot="icon">save</md-icon>
              {{ savingNavigation ? '保存中…' : '保存侧边栏' }}
            </md-filled-button>
          </div>
        </section>
      </div>
    </div>

    <AdminPasswordDialog
      v-if="canChangePassword"
      :open="passwordDialogOpen"
      @close="passwordDialogOpen = false"
    />
  </div>
</template>

<style scoped>
.account-page {
  width: min(100%, 1200px);
}

.account-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.account-title-block {
  min-width: 0;
}

.account-eyebrow,
.section-overline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--md-sys-color-primary);
  font-size: 11px;
  font-weight: 700;
}

.account-eyebrow md-icon {
  --md-icon-size: 16px;
}

.account-title-block .page-title {
  margin: 0 0 4px;
}

.account-title-block p {
  max-width: 620px;
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
}

.account-access-badge {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--md-sys-color-primary) 30%, var(--md-sys-color-outline-variant));
  border-radius: 5px;
  color: var(--md-sys-color-primary);
  background: color-mix(in srgb, var(--md-sys-color-primary) 7%, transparent);
  font-size: 10px;
  font-weight: 700;
}

.account-access-badge md-icon {
  --md-icon-size: 16px;
}

.account-layout {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 0.88fr) minmax(0, 1.12fr);
  gap: 14px;
  align-items: start;
}

.account-column {
  min-width: 0;
  display: grid;
  gap: 14px;
  align-content: start;
}

.account-card {
  min-width: 0;
  width: auto;
  display: block;
  margin: 0;
  border: 1px solid var(--md-sys-color-outline-variant);
  box-shadow: var(--md-sys-elevation-level1);
}

.account-card-heading {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.account-card-heading > div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.account-card-heading .card-title {
  margin: 0;
}

.account-card-heading > md-icon {
  color: var(--md-sys-color-on-surface-variant);
}

.profile-role {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--md-sys-color-primary);
  font-size: 11px;
}

.profile-role md-icon {
  --md-icon-size: 15px;
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
  color: var(--md-sys-color-inverse-on-surface);
  font-size: 12px;
  text-align: center;
  background: color-mix(in srgb, var(--md-sys-color-scrim) 55%, transparent);
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

.navigation-preference-list {
  display: grid;
  margin-top: 16px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
}

.navigation-preference-item {
  min-width: 0;
  min-height: 56px;
  display: grid;
  grid-template-columns: 24px 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  transition: background-color 160ms ease, opacity 160ms ease;
}

.navigation-preference-item--hidden strong,
.navigation-preference-item--hidden .navigation-preference-icon {
  color: var(--md-sys-color-on-surface-variant);
  opacity: 0.68;
}

.navigation-preference-item--dragging {
  opacity: 0.48;
  background: var(--md-sys-color-surface-container-high);
}

.navigation-drag-handle {
  width: 24px;
  height: 40px;
  display: grid;
  place-items: center;
  color: var(--md-sys-color-on-surface-variant);
  cursor: grab;
}

.navigation-drag-handle:active {
  cursor: grabbing;
}

.navigation-drag-handle md-icon {
  --md-icon-size: 20px;
}

.navigation-preference-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface-container-high);
}

.navigation-preference-icon md-icon {
  --md-icon-size: 19px;
}

.navigation-preference-item strong {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.navigation-item-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0;
}

.navigation-item-actions md-icon-button {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
}

.navigation-item-actions md-switch {
  margin-left: 4px;
}

.navigation-preference-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.navigation-preference-empty {
  min-height: 96px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}

.navigation-preference-empty md-icon {
  --md-icon-size: 28px;
}

.account-operation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.logout-btn {
  color: var(--md-sys-color-error);
}

.password-expiry-status {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
}

.password-expiry-status > md-icon {
  flex: 0 0 auto;
  --md-icon-size: 20px;
}

.password-expiry-status > div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.password-expiry-status strong {
  color: var(--md-sys-color-on-surface);
  font-size: 13px;
  font-weight: 600;
}

.password-expiry-status time {
  font-size: 11px;
}

.password-expiry-status--warning,
.password-expiry-status--warning strong {
  color: var(--act-warning);
}

.password-expiry-status--expired,
.password-expiry-status--expired strong {
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
.device-status { display: inline-flex; align-items: center; gap: 4px; padding: 3px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; }
.device-status--current { color: var(--md-sys-color-on-primary-container); background: var(--md-sys-color-primary-container); }
.device-status--online { color: var(--act-success); background: color-mix(in srgb, var(--act-success) 10%, transparent); }
.device-status--online i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.device-meta { min-width: 0; display: flex; flex-wrap: wrap; gap: 8px; color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
.device-meta code { font: 10px 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
.device-location { display: inline-flex; align-items: center; gap: 2px; }
.device-location md-icon { --md-icon-size: 12px; }
.device-item time { display: grid; justify-items: end; gap: 4px; white-space: nowrap; }
.device-item time span { color: var(--md-sys-color-on-surface-variant); font-size: 10px; }
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

@media (max-width: 860px) {
  .account-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 480px) {
  .account-header {
    align-items: stretch;
    flex-direction: column;
    gap: 16px;
  }

  .account-access-badge {
    align-self: flex-start;
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

  .navigation-preference-item {
    grid-template-columns: 20px 32px minmax(0, 1fr);
    row-gap: 2px;
    padding: 8px 0;
  }

  .navigation-preference-icon {
    width: 32px;
    height: 32px;
  }

  .navigation-item-actions {
    grid-column: 2 / -1;
    justify-self: end;
  }

  .navigation-preference-actions md-filled-button {
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
