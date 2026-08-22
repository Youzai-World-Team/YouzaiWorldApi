<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

useHead({ title: '后台用户' })

interface AdminUser {
  id: number
  username: string
  avatar: string
  fullName: string
  isOwner: boolean
  isActive: boolean
  createdAt: number
}

const users = ref<AdminUser[]>([])
const loading = ref(false)
const createOpen = ref(false)
const saving = ref(false)
const username = ref('')
const fullName = ref('')
const password = ref('')
const confirmPassword = ref('')
const createAvatarFile = ref<File | null>(null)
const createAvatarPreview = ref('')
const createAvatarInput = ref<HTMLInputElement | null>(null)
const createDialog = ref<HTMLElement | null>(null)
const resetTarget = ref<AdminUser | null>(null)
const resetPassword = ref('')
const deleteTarget = ref<AdminUser | null>(null)
const { showToast } = useToast()
const { apply: applyDialogAnimation } = useDialogAnimation()

function closeResetDialog() {
  resetTarget.value = null
  resetPassword.value = ''
}

function resetCreateForm() {
  if (createAvatarPreview.value) URL.revokeObjectURL(createAvatarPreview.value)
  createOpen.value = false
  username.value = ''
  fullName.value = ''
  password.value = ''
  confirmPassword.value = ''
  createAvatarFile.value = null
  createAvatarPreview.value = ''
}

function openCreateDialog() {
  resetCreateForm()
  createOpen.value = true
}

function closeCreateDialog() {
  if (!saving.value) createOpen.value = false
}

function onCreateDialogCancel(event: Event) {
  if (saving.value) event.preventDefault()
  else createOpen.value = false
}

function onCreateDialogClosed() {
  if (!saving.value) resetCreateForm()
}

function pickCreateAvatar() {
  createAvatarInput.value?.click()
}

function onCreateAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) {
    showToast('请选择 PNG、JPG、WebP、GIF 或 AVIF 图片', 'error')
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast('头像图片不能超过 2 MiB', 'error')
    return
  }
  if (createAvatarPreview.value) URL.revokeObjectURL(createAvatarPreview.value)
  createAvatarFile.value = file
  createAvatarPreview.value = URL.createObjectURL(file)
}

function clearCreateAvatar() {
  if (createAvatarPreview.value) URL.revokeObjectURL(createAvatarPreview.value)
  createAvatarFile.value = null
  createAvatarPreview.value = ''
}

async function loadUsers() {
  loading.value = true
  try {
    users.value = await $fetch<AdminUser[]>('/api/admin/users')
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '用户列表加载失败', 'error')
  } finally {
    loading.value = false
  }
}

async function createUser() {
  if (saving.value) return
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/.test(username.value.trim())) {
    showToast('用户名需要为 3 至 32 位字母、数字、下划线或连字符', 'error')
    return
  }
  if (password.value.length < 12 || password.value.length > 128) {
    showToast('密码需要为 12 至 128 位', 'error')
    return
  }
  if (password.value !== confirmPassword.value) {
    showToast('两次输入的密码不一致', 'error')
    return
  }
  const normalizedFullName = fullName.value.trim().replace(/\s+/g, ' ')
  if (normalizedFullName.length > 64) {
    showToast('全名不能超过 64 个字符', 'error')
    return
  }
  saving.value = true
  try {
    let avatar = ''
    if (createAvatarFile.value) {
      const form = new FormData()
      form.append('file', createAvatarFile.value)
      const uploaded = await $fetch<{ url: string }>('/api/upload', { method: 'POST', body: form })
      avatar = uploaded.url
    }
    const created = await $fetch<AdminUser>('/api/admin/users', {
      method: 'POST',
      body: {
        username: username.value.trim(),
        fullName: normalizedFullName,
        avatar,
        password: password.value,
        confirmPassword: confirmPassword.value,
      },
    })
    users.value = [...users.value, created].sort((a, b) =>
      Number(b.isOwner) - Number(a.isOwner) || a.username.localeCompare(b.username, 'en', { sensitivity: 'base' }),
    )
    createOpen.value = false
    showToast('后台用户已创建')
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '创建用户失败', 'error')
  } finally {
    saving.value = false
  }
}

async function toggleUser(user: AdminUser) {
  try {
    const updated = await $fetch<AdminUser>(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { active: !user.isActive } })
    user.isActive = updated.isActive
    showToast(updated.isActive ? '用户已启用' : '用户已停用')
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '更新用户状态失败', 'error')
  }
}

async function resetUserPassword() {
  if (!resetTarget.value) return
  if (resetPassword.value.length < 12 || resetPassword.value.length > 128) {
    showToast('密码需要为 12 至 128 位', 'error')
    return
  }
  try {
    await $fetch(`/api/admin/users/${resetTarget.value.id}`, { method: 'PATCH', body: { password: resetPassword.value } })
    showToast('密码已重置')
    closeResetDialog()
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '重置密码失败', 'error')
  }
}

async function deleteUser() {
  if (!deleteTarget.value) return
  try {
    await $fetch(`/api/admin/users/${deleteTarget.value.id}`, { method: 'DELETE' })
    showToast('后台用户已删除')
    deleteTarget.value = null
    await loadUsers()
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '删除用户失败', 'error')
  }
}

function formatDate(value: number) {
  return new Date(value).toLocaleString('zh-CN')
}

onMounted(() => {
  loadUsers()
  applyDialogAnimation(createDialog.value)
})
onBeforeUnmount(() => {
  if (createAvatarPreview.value) URL.revokeObjectURL(createAvatarPreview.value)
})
</script>

<template>
  <div class="page">
    <div class="page-heading">
      <div>
        <h1 class="page-title">后台用户</h1>
        <p class="page-subtitle">所有者可以创建、停用和重置后台用户。</p>
      </div>
      <div class="page-heading-actions">
        <md-icon-button aria-label="创建后台用户" title="创建后台用户" @click="openCreateDialog"><md-icon>add</md-icon></md-icon-button>
        <md-icon-button aria-label="刷新" title="刷新" :disabled="loading" @click="loadUsers"><md-icon>refresh</md-icon></md-icon-button>
      </div>
    </div>

    <section class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>用户名</th><th>全名</th><th>状态</th><th>类型</th><th>创建时间</th><th></th></tr></thead>
          <tbody>
            <tr v-for="user in users" :key="user.id">
              <td class="primary-cell">
                <div class="username-cell">
                  <img v-if="user.avatar" class="user-avatar" :src="user.avatar" :alt="`${user.username}的头像`" />
                  <md-icon v-else class="user-avatar-fallback">account_circle</md-icon>
                  <span>{{ user.username }}</span>
                </div>
              </td>
              <td>{{ user.fullName || '未设置' }}</td>
              <td><span class="status" :class="user.isActive ? 'status--ok' : 'status--pending'">{{ user.isActive ? '启用' : '停用' }}</span></td>
              <td>{{ user.isOwner ? '所有者' : '管理员' }}</td>
              <td>{{ formatDate(user.createdAt) }}</td>
              <td class="row-actions">
                <md-icon-button v-if="!user.isOwner" aria-label="重置密码" title="重置密码" @click="resetTarget = user"><md-icon>lock_reset</md-icon></md-icon-button>
                <md-icon-button v-if="!user.isOwner" :aria-label="user.isActive ? '停用' : '启用'" :title="user.isActive ? '停用' : '启用'" @click="toggleUser(user)"><md-icon>{{ user.isActive ? 'person_off' : 'person' }}</md-icon></md-icon-button>
                <md-icon-button v-if="!user.isOwner" aria-label="删除用户" title="删除用户" @click="deleteTarget = user"><md-icon>delete</md-icon></md-icon-button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!loading && users.length === 0" class="empty">暂无后台用户</p>
      </div>
    </section>

    <md-dialog ref="createDialog" :open="createOpen" @cancel="onCreateDialogCancel" @closed="onCreateDialogClosed">
      <md-icon slot="icon">person_add</md-icon>
      <div slot="headline">创建后台用户</div>
      <div slot="content" class="dialog-form create-dialog-form">
        <md-outlined-text-field
          label="用户名"
          autocomplete="off"
          :value="username"
          @input="username = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
        <md-outlined-text-field
          label="全名（可选）"
          maxlength="64"
          :value="fullName"
          @input="fullName = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
        <div class="create-avatar-control">
          <div class="create-avatar-preview">
            <img v-if="createAvatarPreview" :src="createAvatarPreview" alt="头像预览" />
            <md-icon v-else>account_circle</md-icon>
          </div>
          <div class="create-avatar-actions">
            <md-text-button :disabled="saving" @click="pickCreateAvatar"><md-icon slot="icon">upload</md-icon>选择头像</md-text-button>
            <md-text-button v-if="createAvatarFile" :disabled="saving" @click="clearCreateAvatar"><md-icon slot="icon">delete</md-icon>移除</md-text-button>
          </div>
        </div>
        <input ref="createAvatarInput" class="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" @change="onCreateAvatarChange" />
        <md-outlined-text-field
          type="password"
          label="密码"
          autocomplete="new-password"
          :value="password"
          @input="password = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
        <md-outlined-text-field
          type="password"
          label="确认密码"
          autocomplete="new-password"
          :value="confirmPassword"
          @input="confirmPassword = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
      </div>
      <div slot="actions">
        <md-text-button :disabled="saving" @click="closeCreateDialog">取消</md-text-button>
        <md-text-button :disabled="saving" @click="createUser">{{ saving ? '创建中…' : '创建' }}</md-text-button>
      </div>
    </md-dialog>

    <md-dialog :open="!!resetTarget" @closed="closeResetDialog">
      <md-icon slot="icon">lock_reset</md-icon>
      <div slot="headline">重置用户密码</div>
      <div slot="content" class="dialog-form">
        <p>正在重置 {{ resetTarget?.username }} 的密码。</p>
        <md-outlined-text-field type="password" label="新密码" autocomplete="new-password" :value="resetPassword" @input="resetPassword = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
      </div>
      <div slot="actions"><md-text-button @click="closeResetDialog">取消</md-text-button><md-text-button @click="resetUserPassword">保存</md-text-button></div>
    </md-dialog>

    <ConfirmDialog
      :open="!!deleteTarget"
      title="删除后台用户"
      :message="`确定要删除 ${deleteTarget?.username || ''} 吗？该用户的会话也会失效。`"
      confirm-label="删除"
      :destructive="true"
      @confirm="deleteUser"
      @cancel="deleteTarget = null"
      @closed="deleteTarget = null"
    />
  </div>
</template>

<style scoped>
.page-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.page-heading-actions { display: flex; align-items: center; gap: 4px; }
.page-subtitle { margin: -12px 0 20px; color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 12px 10px; border-bottom: 1px solid var(--md-sys-color-outline-variant); text-align: left; white-space: nowrap; }
.data-table th { color: var(--md-sys-color-on-surface-variant); font-size: 12px; font-weight: 500; }
.primary-cell { font-weight: 600; }
.username-cell { display: flex; align-items: center; gap: 8px; }
.user-avatar, .user-avatar-fallback { width: 32px; height: 32px; flex: 0 0 32px; border-radius: 50%; }
.user-avatar { object-fit: cover; }
.user-avatar-fallback { --md-icon-size: 32px; color: var(--md-sys-color-on-surface-variant); }
.row-actions { text-align: right !important; }
.dialog-form { display: grid; gap: 12px; min-width: min(360px, calc(100vw - 72px)); }
.dialog-form p { margin: 0; color: var(--md-sys-color-on-surface-variant); }
.create-dialog-form { min-width: min(420px, calc(100vw - 72px)); }
.create-avatar-control { display: flex; align-items: center; gap: 16px; }
.create-avatar-preview { width: 64px; height: 64px; display: grid; place-items: center; overflow: hidden; flex: 0 0 64px; border-radius: 50%; color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container-high); }
.create-avatar-preview img { width: 100%; height: 100%; object-fit: cover; }
.create-avatar-preview md-icon { --md-icon-size: 36px; }
.create-avatar-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.hidden-input { display: none; }
.empty { padding: 16px 0; color: var(--md-sys-color-on-surface-variant); }
@media (max-width: 700px) { .create-dialog-form { min-width: min(360px, calc(100vw - 48px)); } }
</style>
