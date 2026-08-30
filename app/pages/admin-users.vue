<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

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
const loading = ref(true)
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
const resetDialog = ref<HTMLElement | null>(null)
const resetTarget = ref<AdminUser | null>(null)
const resetPassword = ref('')
const deleteTarget = ref<AdminUser | null>(null)
const userKeyword = ref('')
const statusFilter = ref<'all' | 'active' | 'inactive'>('all')
const { showToast } = useToast()
const { apply: applyDialogAnimation } = useDialogAnimation()
const access = useAdminAccess()
const { policy: passwordPolicy, load: loadPasswordPolicy, validate: validatePasswordPolicy } = usePasswordPolicy()
const canEdit = computed(() => access.user.value?.isOwner === true)
const activeUsers = computed(() => users.value.filter((user) => user.isActive))
const inactiveUsers = computed(() => users.value.filter((user) => !user.isActive))
const manageableUsers = computed(() => users.value.filter((user) => !user.isOwner))
const filteredUsers = computed(() => {
  const keyword = userKeyword.value.trim().toLocaleLowerCase()
  return users.value.filter((user) => {
    if (statusFilter.value === 'active' && !user.isActive) return false
    if (statusFilter.value === 'inactive' && user.isActive) return false
    if (!keyword) return true
    return `${user.username} ${user.fullName}`.toLocaleLowerCase().includes(keyword)
  })
})
const hasUserFilters = computed(() => Boolean(userKeyword.value.trim()) || statusFilter.value !== 'all')

function clearUserFilters() {
  userKeyword.value = ''
  statusFilter.value = 'all'
}

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
  const passwordPolicyError = validatePasswordPolicy(password.value, 12)
  if (passwordPolicyError) {
    showToast(passwordPolicyError, 'error')
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
      form.append('purpose', 'admin-user-avatar')
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
  const passwordPolicyError = validatePasswordPolicy(resetPassword.value, 12, '新密码')
  if (passwordPolicyError) {
    showToast(passwordPolicyError, 'error')
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
  void loadPasswordPolicy()
  applyDialogAnimation(createDialog.value)
  applyDialogAnimation(resetDialog.value)
})
onBeforeUnmount(() => {
  if (createAvatarPreview.value) URL.revokeObjectURL(createAvatarPreview.value)
})
</script>

<template>
  <div class="page admin-users-page">
    <header class="admin-users-header">
      <div class="admin-users-title-block">
        <span class="admin-users-eyebrow"><md-icon>manage_accounts</md-icon>账户中心</span>
        <h1 class="page-title">后台用户</h1>
        <p>集中管理后台账户、访问状态和安全操作。</p>
      </div>
      <div class="admin-users-header-actions">
        <md-filled-button v-if="canEdit" @click="openCreateDialog">
          <md-icon slot="icon">person_add</md-icon>
          新建用户
        </md-filled-button>
        <md-icon-button aria-label="刷新用户列表" title="刷新用户列表" :disabled="loading" @click="loadUsers">
          <md-icon :class="{ 'refresh-icon--loading': loading }">refresh</md-icon>
        </md-icon-button>
      </div>
    </header>

    <section class="user-overview" aria-label="用户概览">
      <article class="overview-item overview-item--total">
        <span class="overview-icon"><md-icon>groups</md-icon></span>
        <div><strong>{{ users.length }}</strong><span>账户总数</span></div>
      </article>
      <article class="overview-item overview-item--manageable">
        <span class="overview-icon"><md-icon>admin_panel_settings</md-icon></span>
        <div><strong>{{ manageableUsers.length }}</strong><span>可管理账户</span></div>
      </article>
      <article class="overview-item overview-item--active">
        <span class="overview-icon"><md-icon>person_check</md-icon></span>
        <div><strong>{{ activeUsers.length }}</strong><span>已启用</span></div>
      </article>
      <article class="overview-item overview-item--inactive">
        <span class="overview-icon"><md-icon>person_off</md-icon></span>
        <div><strong>{{ inactiveUsers.length }}</strong><span>已停用</span></div>
      </article>
    </section>

    <section class="user-directory" aria-label="后台用户列表">
      <div class="directory-toolbar">
        <md-outlined-text-field
          class="user-search"
          label="搜索用户名或全名"
          type="search"
          :value="userKeyword"
          @input="userKeyword = ($event.target as HTMLInputElement).value"
        >
          <md-icon slot="leading-icon">search</md-icon>
        </md-outlined-text-field>
        <div class="status-filter" role="group" aria-label="账户状态筛选">
          <button type="button" :aria-pressed="statusFilter === 'all'" :class="{ 'status-filter__button--active': statusFilter === 'all' }" @click="statusFilter = 'all'">全部</button>
          <button type="button" :aria-pressed="statusFilter === 'active'" :class="{ 'status-filter__button--active': statusFilter === 'active' }" @click="statusFilter = 'active'">已启用</button>
          <button type="button" :aria-pressed="statusFilter === 'inactive'" :class="{ 'status-filter__button--active': statusFilter === 'inactive' }" @click="statusFilter = 'inactive'">已停用</button>
        </div>
        <md-text-button v-if="hasUserFilters" class="clear-filter-button" @click="clearUserFilters">
          <md-icon slot="icon">filter_alt_off</md-icon>
          清除筛选
        </md-text-button>
      </div>

      <div v-if="loading" class="users-state">
        <md-circular-progress indeterminate></md-circular-progress>
        <span>正在加载用户列表…</span>
      </div>
      <div v-else-if="!filteredUsers.length" class="users-state users-state--empty">
        <md-icon>person_search</md-icon>
        <strong>{{ users.length ? '没有匹配的账户' : '暂无后台用户' }}</strong>
        <span v-if="users.length">尝试调整搜索关键词或状态筛选。</span>
        <md-text-button v-if="hasUserFilters" @click="clearUserFilters">清除筛选</md-text-button>
      </div>
      <div v-else class="user-grid">
        <article
          v-for="user in filteredUsers"
          :key="user.id"
          class="user-card"
          :class="{ 'user-card--owner': user.isOwner, 'user-card--inactive': !user.isActive }"
        >
          <div class="user-card-header">
            <div class="user-identity">
              <span class="user-avatar">
                <img v-if="user.avatar" :src="user.avatar" :alt="`${user.username}的头像`" />
                <md-icon v-else>account_circle</md-icon>
              </span>
              <div class="user-identity-copy">
                <strong>{{ user.fullName || user.username }}</strong>
                <span>@{{ user.username }}</span>
              </div>
            </div>
            <span class="status-badge" :class="user.isActive ? 'status-badge--active' : 'status-badge--inactive'">
              <i></i>{{ user.isActive ? '已启用' : '已停用' }}
            </span>
          </div>

          <div class="user-card-details">
            <div>
              <span>账户类型</span>
              <strong><md-icon>{{ user.isOwner ? 'verified_user' : 'admin_panel_settings' }}</md-icon>{{ user.isOwner ? '初始所有者' : '后台管理员' }}</strong>
            </div>
            <div>
              <span>创建时间</span>
              <time :datetime="new Date(user.createdAt).toISOString()">{{ formatDate(user.createdAt) }}</time>
            </div>
          </div>

          <footer class="user-card-footer">
            <span class="user-card-note" :class="{ 'user-card-note--owner': user.isOwner }">
              <md-icon>{{ user.isOwner ? 'lock' : user.isActive ? 'shield' : 'pause_circle' }}</md-icon>
              {{ user.isOwner ? '初始账户不可操作' : user.isActive ? '账户可正常登录' : '账户暂时不可登录' }}
            </span>
            <div v-if="canEdit && !user.isOwner" class="user-card-actions">
              <md-icon-button aria-label="重置密码" title="重置密码" @click="resetTarget = user"><md-icon>lock_reset</md-icon></md-icon-button>
              <md-icon-button :aria-label="user.isActive ? '停用账户' : '启用账户'" :title="user.isActive ? '停用账户' : '启用账户'" @click="toggleUser(user)"><md-icon>{{ user.isActive ? 'person_off' : 'person' }}</md-icon></md-icon-button>
              <md-icon-button class="user-card-action--danger" aria-label="删除用户" title="删除用户" @click="deleteTarget = user"><md-icon>delete</md-icon></md-icon-button>
            </div>
          </footer>
        </article>
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
        <PasswordStrength :password="password" :min-length="12" :required-score="passwordPolicy.enabled ? passwordPolicy.minimumScore : 0" />
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

    <md-dialog ref="resetDialog" :open="!!resetTarget" @closed="closeResetDialog">
      <md-icon slot="icon">lock_reset</md-icon>
      <div slot="headline">重置用户密码</div>
      <div slot="content" class="dialog-form">
        <p>正在重置 {{ resetTarget?.username }} 的密码。</p>
        <md-outlined-text-field type="password" label="新密码" autocomplete="new-password" :value="resetPassword" @input="resetPassword = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
        <PasswordStrength :password="resetPassword" :min-length="12" :required-score="passwordPolicy.enabled ? passwordPolicy.minimumScore : 0" />
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
.admin-users-page {
  width: min(100%, 1280px);
}

.admin-users-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.admin-users-title-block {
  min-width: 0;
}

.admin-users-eyebrow,
.section-overline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--md-sys-color-primary);
  font-size: 11px;
  font-weight: 700;
}

.admin-users-eyebrow md-icon {
  --md-icon-size: 16px;
}

.admin-users-title-block .page-title {
  margin: 6px 0 4px;
}

.admin-users-title-block p {
  max-width: 560px;
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
}

.admin-users-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.refresh-icon--loading {
  animation: refresh-spin 800ms linear infinite;
}

@keyframes refresh-spin {
  to { transform: rotate(360deg); }
}

.user-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 26px;
}

.overview-item {
  min-width: 0;
  min-height: 78px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 8px;
  background: var(--md-sys-color-surface-container);
}

.overview-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  flex: 0 0 38px;
  border-radius: 8px;
  color: var(--md-sys-color-primary);
  background: var(--md-sys-color-primary-container);
}

.overview-icon md-icon {
  --md-icon-size: 21px;
}

.overview-item > div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.overview-item strong {
  color: var(--md-sys-color-on-surface);
  font-size: 21px;
  line-height: 1;
}

.overview-item > div > span {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 11px;
}

.overview-item--manageable .overview-icon {
  color: var(--act-info);
  background: color-mix(in srgb, var(--act-info) 12%, transparent);
}

.overview-item--active .overview-icon {
  color: var(--act-success);
  background: color-mix(in srgb, var(--act-success) 12%, transparent);
}

.overview-item--inactive .overview-icon {
  color: var(--act-warning);
  background: color-mix(in srgb, var(--act-warning) 13%, transparent);
}

.user-directory {
  min-width: 0;
}

.directory-toolbar {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding: 0 0 14px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.user-search {
  min-width: 220px;
  flex: 1 1 280px;
  width: 100%;
}

.status-filter {
  height: 40px;
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  align-items: center;
  padding: 3px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 7px;
  background: var(--md-sys-color-surface-container);
}

.status-filter button {
  height: 32px;
  border: 0;
  border-radius: 5px;
  padding: 0 12px;
  color: var(--md-sys-color-on-surface-variant);
  background: transparent;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition:
    color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard);
}

.status-filter button:hover:not(.status-filter__button--active) {
  color: var(--md-sys-color-on-surface);
  background: color-mix(in srgb, var(--md-sys-color-on-surface) var(--md-sys-state-hover-state-layer-opacity), transparent);
}

.status-filter__button--active {
  color: var(--md-sys-color-on-primary-container) !important;
  background: var(--md-sys-color-primary-container) !important;
  font-weight: 700;
}

.clear-filter-button {
  flex: 0 0 auto;
}

.users-state {
  min-height: 300px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: var(--md-sys-color-on-surface-variant);
  text-align: center;
}

.users-state > md-circular-progress {
  width: 32px;
  height: 32px;
}

.users-state--empty > md-icon {
  --md-icon-size: 34px;
}

.users-state--empty strong {
  color: var(--md-sys-color-on-surface);
  font-size: 14px;
}

.users-state--empty span {
  font-size: 12px;
}

.user-grid {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.user-card {
  min-width: 0;
  display: grid;
  overflow: hidden;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 8px;
  background: var(--md-sys-color-surface-container);
  transition:
    border-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard),
    box-shadow var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard);
}

.user-card:hover {
  border-color: color-mix(in srgb, var(--md-sys-color-primary) 35%, var(--md-sys-color-outline-variant));
  box-shadow: var(--md-sys-elevation-level1);
  transform: translateY(-1px);
}

.user-card--owner {
  border-color: color-mix(in srgb, var(--md-sys-color-primary) 42%, var(--md-sys-color-outline-variant));
}

.user-card--inactive {
  background: color-mix(in srgb, var(--act-warning) 3%, var(--md-sys-color-surface-container));
}

.user-card-header {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.user-identity {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-avatar {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  flex: 0 0 48px;
  overflow: hidden;
  border-radius: 50%;
  color: var(--md-sys-color-on-primary-container);
  background: var(--md-sys-color-primary-container);
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-avatar md-icon {
  --md-icon-size: 28px;
}

.user-identity-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.user-identity-copy strong,
.user-identity-copy span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-identity-copy strong {
  color: var(--md-sys-color-on-surface);
  font-size: 15px;
}

.user-identity-copy span {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 11px;
}

.status-badge {
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 0 8px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

.status-badge i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.status-badge--active {
  border-color: color-mix(in srgb, var(--act-success) 42%, transparent);
  color: var(--act-success);
  background: color-mix(in srgb, var(--act-success) 8%, transparent);
}

.status-badge--inactive {
  border-color: color-mix(in srgb, var(--act-warning) 44%, transparent);
  color: var(--act-warning);
  background: color-mix(in srgb, var(--act-warning) 9%, transparent);
}

.user-card-details {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 14px 16px;
}

.user-card-details > div {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.user-card-details > div > span {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 10px;
}

.user-card-details strong,
.user-card-details time {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  color: var(--md-sys-color-on-surface);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-card-details md-icon {
  --md-icon-size: 16px;
  flex: 0 0 auto;
  color: var(--md-sys-color-primary);
}

.user-card-footer {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px 9px 16px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
}

.user-card-note {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-card-note md-icon {
  --md-icon-size: 15px;
  flex: 0 0 auto;
}

.user-card-note--owner {
  color: var(--md-sys-color-primary);
}

.user-card-actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 0;
}

.user-card-action--danger {
  color: var(--act-error);
}

.dialog-form {
  min-width: min(360px, calc(100vw - 72px));
  display: grid;
  gap: 14px;
}

.dialog-form md-outlined-text-field,
.dialog-form md-outlined-select {
  width: 100%;
}

.dialog-form p {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  line-height: 1.6;
}

.create-dialog-form {
  min-width: min(420px, calc(100vw - 72px));
}

.create-avatar-control {
  display: flex;
  align-items: center;
  gap: 16px;
}

.create-avatar-preview {
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  overflow: hidden;
  flex: 0 0 64px;
  border-radius: 50%;
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface-container-high);
}

.create-avatar-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.create-avatar-preview md-icon {
  --md-icon-size: 36px;
}

.create-avatar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.hidden-input {
  display: none;
}

@media (max-width: 1000px) {
  .user-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .admin-users-header {
    align-items: stretch;
    flex-direction: column;
    gap: 16px;
  }

  .admin-users-header-actions {
    justify-content: flex-end;
  }

  .directory-toolbar {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .user-search {
    flex-basis: 100%;
  }

  .status-filter {
    flex: 1;
  }

  .status-filter button {
    width: 100%;
  }

  .user-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 520px) {
  .admin-users-header-actions {
    justify-content: space-between;
  }

  .admin-users-header-actions md-filled-button {
    flex: 1;
  }

  .clear-filter-button {
    margin-left: auto;
  }

  .user-card-header {
    padding: 14px;
  }

  .user-card-footer {
    align-items: flex-start;
  }

  .user-card-note {
    white-space: normal;
  }

  .dialog-form,
  .create-dialog-form {
    width: 100%;
    min-width: 0;
  }

  .create-avatar-control {
    align-items: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .user-card,
  .status-filter button {
    transition-duration: 1ms;
  }

  .refresh-icon--loading {
    animation: none;
  }
}
</style>
