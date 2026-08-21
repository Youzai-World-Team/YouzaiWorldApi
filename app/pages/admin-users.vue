<script setup lang="ts">
import { onMounted, ref } from 'vue'

useHead({ title: '后台用户' })

interface AdminUser {
  id: number
  username: string
  isOwner: boolean
  isActive: boolean
  createdAt: number
}

const users = ref<AdminUser[]>([])
const loading = ref(false)
const saving = ref(false)
const username = ref('')
const password = ref('')
const resetTarget = ref<AdminUser | null>(null)
const resetPassword = ref('')
const deleteTarget = ref<AdminUser | null>(null)
const { showToast } = useToast()

function closeResetDialog() {
  resetTarget.value = null
  resetPassword.value = ''
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
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/.test(username.value.trim())) {
    showToast('用户名需要为 3 至 32 位字母、数字、下划线或连字符', 'error')
    return
  }
  if (password.value.length < 12 || password.value.length > 128) {
    showToast('密码需要为 12 至 128 位', 'error')
    return
  }
  saving.value = true
  try {
    await $fetch('/api/admin/users', { method: 'POST', body: { username: username.value.trim(), password: password.value } })
    username.value = ''
    password.value = ''
    showToast('后台用户已创建')
    await loadUsers()
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

onMounted(loadUsers)
</script>

<template>
  <div class="page">
    <div class="page-heading">
      <div>
        <h1 class="page-title">后台用户</h1>
        <p class="page-subtitle">所有者可以创建、停用和重置后台用户。</p>
      </div>
      <md-icon-button aria-label="刷新" title="刷新" :disabled="loading" @click="loadUsers"><md-icon>refresh</md-icon></md-icon-button>
    </div>

    <section class="card user-create-card">
      <h2 class="card-title">创建后台用户</h2>
      <div class="create-form">
        <md-outlined-text-field label="用户名" autocomplete="off" :value="username" @input="username = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
        <md-outlined-text-field type="password" label="初始密码" autocomplete="new-password" :value="password" @input="password = ($event.target as HTMLInputElement).value"></md-outlined-text-field>
        <md-filled-button :disabled="saving" @click="createUser"><md-icon slot="icon">person_add</md-icon>创建</md-filled-button>
      </div>
    </section>

    <section class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>用户名</th><th>状态</th><th>类型</th><th>创建时间</th><th></th></tr></thead>
          <tbody>
            <tr v-for="user in users" :key="user.id">
              <td class="primary-cell">{{ user.username }}</td>
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
.page-subtitle { margin: -12px 0 20px; color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.user-create-card { margin-bottom: 20px; }
.create-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)) auto; gap: 12px; align-items: center; }
.create-form md-outlined-text-field { width: 100%; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 12px 10px; border-bottom: 1px solid var(--md-sys-color-outline-variant); text-align: left; white-space: nowrap; }
.data-table th { color: var(--md-sys-color-on-surface-variant); font-size: 12px; font-weight: 500; }
.primary-cell { font-weight: 600; }
.row-actions { text-align: right !important; }
.dialog-form { display: grid; gap: 12px; min-width: min(360px, calc(100vw - 72px)); }
.dialog-form p { margin: 0; color: var(--md-sys-color-on-surface-variant); }
.empty { padding: 16px 0; color: var(--md-sys-color-on-surface-variant); }
@media (max-width: 700px) { .create-form { grid-template-columns: 1fr; } .create-form md-filled-button { width: 100%; } }
</style>
