<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type {
  AdminPageDefinition,
  AdminPagePermissionLevel,
} from '#shared/admin-page-permissions'

useHead({ title: '权限管理' })

interface PermissionUser {
  id: number
  username: string
  avatar: string
  fullName: string
  isOwner: boolean
  isActive: boolean
  permissions: Record<string, AdminPagePermissionLevel>
}

interface PermissionResponse {
  pages: AdminPageDefinition[]
  users: PermissionUser[]
}

const access = useAdminAccess()
const { showToast } = useToast()
const pages = ref<AdminPageDefinition[]>([])
const users = ref<PermissionUser[]>([])
const selectedUserId = ref<number | null>(null)
const drafts = ref<Record<string, AdminPagePermissionLevel>>({})
const loading = ref(true)
const saving = ref(false)

const selectedUser = computed(() => users.value.find((user) => user.id === selectedUserId.value) || null)
const canManage = computed(() => access.user.value?.isOwner === true)

function selectUser(user: PermissionUser) {
  selectedUserId.value = user.id
  drafts.value = { ...user.permissions }
}

function setPermission(page: AdminPageDefinition, level: AdminPagePermissionLevel) {
  if (!canManage.value || selectedUser.value?.isOwner) return
  drafts.value[page.key] = page.maxNonOwnerLevel === 'hidden'
    ? 'hidden'
    : page.maxNonOwnerLevel === 'view' && level === 'edit'
      ? 'view'
      : level
}

async function loadPermissions() {
  loading.value = true
  try {
    const result = await $fetch<PermissionResponse>('/api/admin/permissions')
    pages.value = result.pages
    users.value = result.users
    const next = result.users.find((user) => user.id === selectedUserId.value)
      || result.users.find((user) => !user.isOwner)
      || result.users[0]
    if (next) selectUser(next)
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '权限配置加载失败', 'error')
  } finally {
    loading.value = false
  }
}

async function savePermissions() {
  const user = selectedUser.value
  if (!user || user.isOwner || !canManage.value || saving.value) return
  saving.value = true
  try {
    const updated = await $fetch<PermissionUser>(`/api/admin/permissions/${user.id}`, {
      method: 'PATCH',
      body: { permissions: drafts.value },
    })
    const index = users.value.findIndex((item) => item.id === updated.id)
    if (index >= 0) users.value[index] = updated
    drafts.value = { ...updated.permissions }
    showToast(`已保存 ${updated.fullName || updated.username} 的页面权限`)
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '权限保存失败', 'error')
  } finally {
    saving.value = false
  }
}

onMounted(loadPermissions)
</script>

<template>
  <div class="page permissions-page">
    <div class="page-heading">
      <div>
        <h1 class="page-title">权限管理</h1>
        <p class="page-subtitle">为每个后台账户设置页面的隐藏、查看或编辑权限。</p>
      </div>
      <md-icon-button aria-label="刷新" title="刷新" :disabled="loading" @click="loadPermissions">
        <md-icon>refresh</md-icon>
      </md-icon-button>
    </div>

    <div v-if="loading" class="empty">正在加载权限配置…</div>
    <template v-else>
      <div class="permission-layout">
        <aside class="user-list card" aria-label="后台账户">
          <button
            v-for="user in users"
            :key="user.id"
            type="button"
            class="user-option"
            :class="{ 'user-option--active': user.id === selectedUserId }"
            @click="selectUser(user)"
          >
            <img v-if="user.avatar" :src="user.avatar" alt="" />
            <md-icon v-else>account_circle</md-icon>
            <span>
              <strong>{{ user.fullName || user.username }}</strong>
              <small>{{ user.username }}</small>
            </span>
          </button>
        </aside>

        <section v-if="selectedUser" class="card permission-panel">
          <div class="permission-heading">
            <div>
              <h2 class="card-title">{{ selectedUser.fullName || selectedUser.username }}</h2>
              <p>{{ selectedUser.isOwner ? '初始所有者始终拥有全部编辑权限。' : '权限修改在保存后生效。' }}</p>
            </div>
            <md-filled-button
              v-if="canManage && !selectedUser.isOwner"
              :disabled="saving"
              @click="savePermissions"
            >
              <md-icon slot="icon">save</md-icon>
              {{ saving ? '保存中…' : '保存权限' }}
            </md-filled-button>
          </div>

          <div class="permission-list">
            <div v-for="page in pages" :key="page.key" class="permission-row">
              <div class="permission-page-name">
                <md-icon>{{ page.icon }}</md-icon>
                <span>
                  <strong>{{ page.label }}</strong>
                  <small v-if="page.key === 'settings'">新账户默认可查看</small>
                  <small v-else-if="page.maxNonOwnerLevel === 'hidden'">仅初始账户可查看和编辑</small>
                  <small v-else-if="page.key === 'permissions'">新账户默认隐藏，非所有者最多可查看</small>
                  <small v-else>新账户默认可编辑</small>
                </span>
              </div>
              <div class="permission-options" role="group" :aria-label="`${page.label}权限`">
                <button
                  v-for="option in (selectedUser.isOwner ? ['edit'] : page.maxNonOwnerLevel === 'hidden' ? ['hidden'] : page.maxNonOwnerLevel === 'view' ? ['hidden', 'view'] : ['hidden', 'view', 'edit'])"
                  :key="option"
                  type="button"
                  :class="{ 'permission-option--active': (selectedUser.isOwner ? 'edit' : drafts[page.key]) === option }"
                  :disabled="!canManage || selectedUser.isOwner"
                  @click="setPermission(page, option as AdminPagePermissionLevel)"
                >
                  {{ option === 'hidden' ? '隐藏' : option === 'view' ? '查看' : '编辑' }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-heading,
.permission-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.page-subtitle,
.permission-heading p {
  margin: -12px 0 20px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
}

.permission-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.user-list {
  display: grid;
  gap: 4px;
  padding: 8px;
}

.user-option {
  width: 100%;
  min-height: 52px;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  border: 0;
  border-radius: 6px;
  padding: 8px 10px;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.user-option:hover,
.user-option--active {
  background: var(--md-sys-color-secondary-container);
}

.user-option img,
.user-option > md-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}

.user-option span,
.permission-page-name span {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.user-option strong,
.user-option small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-option small,
.permission-page-name small {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 11px;
}

.permission-heading .card-title {
  margin-bottom: 16px;
}

.permission-list {
  display: grid;
  margin-top: 8px;
}

.permission-row {
  min-height: 68px;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto;
  align-items: center;
  gap: 16px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  padding: 10px 0;
}

.permission-page-name {
  min-width: 0;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.permission-options {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(62px, auto);
  border: 1px solid var(--md-sys-color-outline);
  border-radius: 6px;
  overflow: hidden;
}

.permission-options button {
  min-height: 36px;
  border: 0;
  border-right: 1px solid var(--md-sys-color-outline-variant);
  padding: 0 12px;
  color: var(--md-sys-color-on-surface-variant);
  background: transparent;
  cursor: pointer;
}

.permission-options button:last-child {
  border-right: 0;
}

.permission-options button:disabled {
  cursor: default;
}

.permission-options .permission-option--active {
  color: var(--md-sys-color-on-secondary-container);
  background: var(--md-sys-color-secondary-container);
  font-weight: 600;
}

.empty {
  color: var(--md-sys-color-on-surface-variant);
}

@media (max-width: 760px) {
  .permission-layout {
    grid-template-columns: 1fr;
  }

  .permission-heading {
    flex-direction: column;
    align-items: stretch;
  }

  .user-list {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .permission-row {
    grid-template-columns: 1fr;
  }

  .permission-options {
    width: 100%;
    grid-auto-columns: 1fr;
  }

  .permission-heading md-filled-button {
    width: 100%;
  }
}
</style>
