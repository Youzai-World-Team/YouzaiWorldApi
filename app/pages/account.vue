<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const updating = ref(false)

const entryInput = ref('')
const currentEntry = ref('')
const savingEntry = ref(false)

const fileInput = ref<HTMLInputElement | null>(null)
const uploadingAvatar = ref(false)
const fullNameInput = ref('')
const savingFullName = ref(false)

const { showToast } = useToast()
const { entry: entryState, load: loadEntry } = useEntry()
const access = useAdminAccess()
interface CurrentUser {
  username: string
  avatar: string
  fullName: string
  isOwner: boolean
}

const currentUser = ref<CurrentUser | null>(null)
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
  currentEntry.value = await loadEntry()
  entryInput.value = currentEntry.value
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

async function saveEntry() {
  if (savingEntry.value) return
  const val = entryInput.value.trim().replace(/^\/+|\/+$/g, '')
  if (!val) {
    showToast('入口不能为空', 'error')
    return
  }
  savingEntry.value = true
  try {
    const res = await $fetch<{ entry: string }>('/api/auth/entry', {
      method: 'POST',
      body: { entry: val }
    })
    currentEntry.value = res.entry
    entryInput.value = res.entry
    entryState.value = res.entry
    showToast(`安全入口已更新为 /${res.entry}`)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '保存失败', 'error')
  } finally {
    savingEntry.value = false
  }
}

function pickAvatar() {
  if (!canChangeAvatar.value) return
  fileInput.value?.click()
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
          supporting-text="作为对外显示的名称；留空时显示用户名"
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

    <section v-if="currentUser?.isOwner" class="card account-card">
      <h2 class="card-title">安全入口</h2>
      <p class="entry-hint">登录页只能通过该入口访问。当前入口：<code class="entry-code">/{{ currentEntry || '…' }}</code></p>
      <div class="form">
        <md-outlined-text-field
          label="安全入口"
          :value="entryInput"
          @input="entryInput = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
        <md-filled-button :disabled="savingEntry" @click="saveEntry">
          {{ savingEntry ? '保存中…' : '保存入口' }}
        </md-filled-button>
      </div>
    </section>

    <section class="card account-card">
      <h2 class="card-title">账户操作</h2>
      <md-text-button class="logout-btn" @click="logout">
        <md-icon slot="icon">logout</md-icon>
        登出账户
      </md-text-button>
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

.entry-hint {
  margin: 0 0 16px;
  font-size: 14px;
  color: var(--md-sys-color-on-surface-variant);
}

.entry-code {
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  color: var(--md-sys-color-primary);
  overflow-wrap: anywhere;
}

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
}
</style>
