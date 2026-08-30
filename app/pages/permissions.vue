<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type {
  AdminFeatureDefinition,
  AdminFeaturePermissionLevel,
  AdminPageDefinition,
  AdminPagePermissionLevel,
} from '#shared/admin-page-permissions'

useHead({ title: '权限管理' })

type DraftPermissionLevel = AdminPagePermissionLevel | 'unchanged'

interface PermissionUser {
  id: number
  username: string
  avatar: string
  fullName: string
  isOwner: boolean
  isActive: boolean
  permissions: Record<string, AdminPagePermissionLevel>
  featurePermissions: Record<string, AdminFeaturePermissionLevel>
}

interface PermissionResponse {
  pages: AdminPageDefinition[]
  features: AdminFeatureDefinition[]
  users: PermissionUser[]
}

const access = useAdminAccess()
const { showToast } = useToast()
const pages = ref<AdminPageDefinition[]>([])
const features = ref<AdminFeatureDefinition[]>([])
const users = ref<PermissionUser[]>([])
const selectedUserIds = ref<number[]>([])
const drafts = ref<Record<string, DraftPermissionLevel>>({})
const featureDrafts = ref<Record<string, DraftPermissionLevel>>({})
const expandedParents = ref<Set<string>>(new Set())
const userKeyword = ref('')
const loading = ref(true)
const saving = ref(false)
const selectionInteracted = ref(false)
const bulkSelectionMode = ref(false)

const selectedUsers = computed(() => users.value.filter((user) => selectedUserIds.value.includes(user.id)))
const manageableUsers = computed(() => users.value.filter((user) => !user.isOwner))
const selectedManageableUsers = computed(() => selectedUsers.value.filter((user) => !user.isOwner))
const filteredUsers = computed(() => {
  const keyword = userKeyword.value.trim().toLocaleLowerCase()
  if (!keyword) return users.value
  return users.value.filter((user) => `${user.fullName} ${user.username}`.toLocaleLowerCase().includes(keyword))
})
const selectedUser = computed(() => selectedUsers.value.length === 1 ? selectedUsers.value[0]! : null)
const bulkMode = computed(() => bulkSelectionMode.value && selectedUsers.value.length > 1)
const ownerSelected = computed(() => selectedUsers.value.some((user) => user.isOwner))
const canManage = computed(() => access.user.value?.isOwner === true)
const canEditSelection = computed(() => canManage.value && selectedUsers.value.length > 0 && !ownerSelected.value)
const accountFeatures = computed(() => features.value.filter((feature) => feature.parentKey === 'account'))
const expandableParentKeys = computed(() => [
  ...(accountFeatures.value.length ? ['account'] : []),
  ...pages.value.filter((page) => featuresForParent(page.key).length).map((page) => page.key),
])
const allParentsExpanded = computed(() => expandableParentKeys.value.length > 0
  && expandableParentKeys.value.every((key) => expandedParents.value.has(key)))
const panelTitle = computed(() => bulkMode.value
  ? `${selectedUsers.value.length} 位后台用户`
  : selectedUser.value?.fullName || selectedUser.value?.username || '')
const hasDraftChanges = computed(() => {
  if (!canEditSelection.value) return false
  if (bulkMode.value) {
    return Object.values(drafts.value).some((level) => level !== 'unchanged')
      || Object.values(featureDrafts.value).some((level) => level !== 'unchanged')
  }
  const user = selectedUser.value
  if (!user) return false
  return pages.value.some((page) => drafts.value[page.key] !== user.permissions[page.key])
    || features.value.some((feature) => featureDrafts.value[feature.key] !== user.featurePermissions[feature.key])
})

function resetDrafts() {
  const user = selectedUser.value
  if (user) {
    drafts.value = { ...user.permissions }
    featureDrafts.value = { ...user.featurePermissions }
    return
  }
  if (bulkMode.value) {
    drafts.value = Object.fromEntries(pages.value.map((page) => [page.key, 'unchanged']))
    featureDrafts.value = Object.fromEntries(features.value.map((feature) => [feature.key, 'unchanged']))
    return
  }
  drafts.value = {}
  featureDrafts.value = {}
}

function isSelected(user: PermissionUser) {
  return selectedUserIds.value.includes(user.id)
}

function toggleBulkSelection() {
  if (!canManage.value || manageableUsers.value.length < 2 || ownerSelected.value) return
  selectionInteracted.value = true
  if (bulkSelectionMode.value) {
    bulkSelectionMode.value = false
    const keep = selectedUsers.value.find((user) => !user.isOwner) || selectedUsers.value[0]
    selectedUserIds.value = keep ? [keep.id] : []
  } else {
    bulkSelectionMode.value = true
  }
  resetDrafts()
}

function toggleUser(user: PermissionUser) {
  selectionInteracted.value = true
  if (!bulkSelectionMode.value) {
    selectedUserIds.value = [user.id]
    resetDrafts()
    return
  }
  if (user.isOwner) {
    bulkSelectionMode.value = false
    selectedUserIds.value = [user.id]
    resetDrafts()
    return
  }
  const current = selectedUserIds.value
  const currentHasOwner = selectedUsers.value.some((item) => item.isOwner)
  if (currentHasOwner) selectedUserIds.value = [user.id]
  else if (current.includes(user.id)) {
    if (current.length === 1) return
    selectedUserIds.value = current.filter((id) => id !== user.id)
  } else selectedUserIds.value = [...current, user.id]
  resetDrafts()
}

function pageOptions(page: AdminPageDefinition): DraftPermissionLevel[] {
  if (ownerSelected.value) return [page.readOnly ? 'view' : 'edit']
  const options: AdminPagePermissionLevel[] = page.maxNonOwnerLevel === 'hidden'
    ? ['hidden']
    : page.maxNonOwnerLevel === 'view' || page.readOnly
      ? ['hidden', 'view']
      : ['hidden', 'view', 'edit']
  return bulkMode.value ? ['unchanged', ...options] : options
}

function setPermission(page: AdminPageDefinition, level: DraftPermissionLevel) {
  if (!canEditSelection.value || !pageOptions(page).includes(level)) return
  drafts.value[page.key] = level
  for (const feature of features.value) {
    if (feature.pageKey !== page.key) continue
    const options = featureOptions(feature)
    if (options.includes(featureDrafts.value[feature.key] || 'hidden')) continue
    featureDrafts.value[feature.key] = bulkMode.value
      ? 'unchanged'
      : options.includes('view')
        ? 'view'
        : options.includes('hidden')
          ? 'hidden'
          : (options[0] || 'hidden')
  }
}

function featureOptions(feature: AdminFeatureDefinition): DraftPermissionLevel[] {
  if (ownerSelected.value) return ['edit']
  let options = feature.availableLevels || ['hidden', 'view', 'edit']
  if (feature.maxNonOwnerLevel === 'hidden') options = ['hidden']
  else if (feature.maxNonOwnerLevel === 'view') options = options.filter((level) => level !== 'edit')

  if (feature.pageKey) {
    const draftPageLevel = drafts.value[feature.pageKey] || 'hidden'
    if (draftPageLevel === 'hidden') options = ['hidden']
    else if (draftPageLevel === 'view') options = options.filter((level) => level !== 'edit')
    else if (draftPageLevel === 'unchanged') {
      const allCanEditPage = selectedUsers.value.every((user) => user.permissions[feature.pageKey!] === 'edit')
      if (!allCanEditPage) options = options.filter((level) => level !== 'edit')
    }
  }
  return bulkMode.value ? ['unchanged', ...options] : options
}

function setFeaturePermission(feature: AdminFeatureDefinition, level: DraftPermissionLevel) {
  if (!canEditSelection.value || !featureOptions(feature).includes(level)) return
  featureDrafts.value[feature.key] = level
}

function permissionLabel(level: DraftPermissionLevel, feature = false) {
  if (level === 'unchanged') return '保持不变'
  if (level === 'hidden') return '隐藏'
  if (level === 'view') return '查看'
  return feature ? '修改' : '编辑'
}

function featuresForParent(parentKey: string) {
  return features.value.filter((feature) => feature.parentKey === parentKey)
}

function isParentExpanded(parentKey: string) {
  return expandedParents.value.has(parentKey)
}

function toggleParent(parentKey: string) {
  const next = new Set(expandedParents.value)
  if (next.has(parentKey)) next.delete(parentKey)
  else next.add(parentKey)
  expandedParents.value = next
}

function toggleAllParents() {
  const next = new Set(expandedParents.value)
  if (allParentsExpanded.value) expandableParentKeys.value.forEach((key) => next.delete(key))
  else expandableParentKeys.value.forEach((key) => next.add(key))
  expandedParents.value = next
}

function userRoleLabel(user: PermissionUser) {
  if (user.isOwner) return '初始所有者'
  return user.isActive ? '后台用户' : '已停用'
}

function replaceUsers(updatedUsers: PermissionUser[]) {
  const byId = new Map(updatedUsers.map((user) => [user.id, user]))
  users.value = users.value.map((user) => byId.get(user.id) || user)
}

async function loadPermissions() {
  loading.value = true
  try {
    const result = await $fetch<PermissionResponse>('/api/admin/permissions')
    pages.value = result.pages
    features.value = result.features
    users.value = result.users
    const availableIds = new Set(result.users.map((user) => user.id))
    selectedUserIds.value = selectedUserIds.value.filter((id) => availableIds.has(id))
    if (!selectionInteracted.value || !selectedUserIds.value.length) {
      const first = result.users.find((user) => !user.isOwner) || result.users[0]
      selectedUserIds.value = first ? [first.id] : []
    }
    resetDrafts()
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '权限配置加载失败', 'error')
  } finally {
    loading.value = false
  }
}

async function savePermissions() {
  if (!canEditSelection.value || !hasDraftChanges.value || saving.value) return
  saving.value = true
  try {
    if (bulkMode.value) {
      const permissions = Object.fromEntries(Object.entries(drafts.value).filter(([, level]) => level !== 'unchanged'))
      const featurePermissions = Object.fromEntries(Object.entries(featureDrafts.value).filter(([, level]) => level !== 'unchanged'))
      const result = await $fetch<{ users: PermissionUser[] }>('/api/admin/permissions', {
        method: 'PATCH',
        body: { userIds: selectedUserIds.value, permissions, featurePermissions },
      })
      replaceUsers(result.users)
      resetDrafts()
      showToast(`已保存 ${result.users.length} 位用户的权限`)
      return
    }

    const user = selectedUser.value!
    const updated = await $fetch<PermissionUser>(`/api/admin/permissions/${user.id}`, {
      method: 'PATCH',
      body: { permissions: drafts.value, featurePermissions: featureDrafts.value },
    })
    replaceUsers([updated])
    resetDrafts()
    showToast(`已保存 ${updated.fullName || updated.username} 的权限`)
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '权限保存失败', 'error')
  } finally {
    saving.value = false
  }
}

onMounted(loadPermissions)
</script>

<template>
  <div class="page page--wide permissions-page">
    <header class="permissions-header">
      <div class="permissions-title-block">
        <span class="permissions-eyebrow"><md-icon>admin_panel_settings</md-icon>访问控制</span>
        <h1 class="page-title">权限管理</h1>
        <p>按后台账户配置页面访问范围和细分操作权限。</p>
      </div>
      <div class="permissions-header-actions">
        <div class="permissions-stats" aria-label="权限概览">
          <div class="permission-stat">
            <strong>{{ manageableUsers.length }}</strong>
            <span>可管理账户</span>
          </div>
          <div class="permission-stat">
            <strong>{{ pages.length }}</strong>
            <span>页面</span>
          </div>
          <div class="permission-stat">
            <strong>{{ features.length }}</strong>
            <span>细分权限</span>
          </div>
        </div>
        <md-icon-button aria-label="刷新权限配置" title="刷新权限配置" :disabled="loading" @click="loadPermissions">
          <md-icon>refresh</md-icon>
        </md-icon-button>
      </div>
    </header>

    <div v-if="loading" class="permission-loading">
      <md-circular-progress indeterminate></md-circular-progress>
      <span>正在加载权限配置…</span>
    </div>
    <template v-else>
      <div class="permission-layout">
        <aside class="user-list card" aria-label="后台账户">
          <div class="user-list-header">
            <div>
              <span class="section-overline">管理对象</span>
              <h2>后台账户</h2>
            </div>
            <div class="user-list-header-actions">
              <span class="user-count">已选 {{ selectedManageableUsers.length }}/{{ manageableUsers.length }}</span>
              <md-icon-button
                v-if="canManage && manageableUsers.length > 1"
                class="bulk-selection-button"
                :disabled="ownerSelected"
                :aria-label="bulkSelectionMode ? '完成批量选择' : '进入批量选择'"
                :title="bulkSelectionMode ? '完成批量选择' : '进入批量选择'"
                :aria-pressed="bulkSelectionMode"
                @click="toggleBulkSelection"
              >
                <md-icon>{{ bulkSelectionMode ? 'done' : 'group_add' }}</md-icon>
              </md-icon-button>
            </div>
          </div>
          <md-outlined-text-field
            class="user-search"
            label="搜索账户"
            type="search"
            :value="userKeyword"
            @input="userKeyword = ($event.target as HTMLInputElement).value"
          >
            <md-icon slot="leading-icon">search</md-icon>
          </md-outlined-text-field>
          <div class="user-options">
            <button
              v-for="user in filteredUsers"
              :key="user.id"
              type="button"
              class="user-option"
              :class="{ 'user-option--active': isSelected(user) }"
              :aria-pressed="isSelected(user)"
              @click="toggleUser(user)"
            >
              <span class="user-avatar">
                <img v-if="user.avatar" :src="user.avatar" alt="" />
                <md-icon v-else>account_circle</md-icon>
              </span>
              <span class="user-copy">
                <strong>{{ user.fullName || user.username }}</strong>
                <small>{{ user.username }}</small>
              </span>
              <span class="user-meta">
                <span class="user-role" :class="{ 'user-role--owner': user.isOwner, 'user-role--inactive': !user.isActive && !user.isOwner }">{{ userRoleLabel(user) }}</span>
                <md-icon v-if="user.isOwner" class="user-selection" title="初始所有者">verified_user</md-icon>
                <md-checkbox v-else-if="bulkSelectionMode" class="user-selection" :checked="isSelected(user)" tabindex="-1"></md-checkbox>
                <md-icon v-else class="user-selection" :title="isSelected(user) ? '当前账户' : '选择账户'">{{ isSelected(user) ? 'radio_button_checked' : 'radio_button_unchecked' }}</md-icon>
              </span>
            </button>
          </div>
          <div v-if="!filteredUsers.length" class="user-filter-empty">
            <md-icon>person_search</md-icon>
            <span>没有匹配的账户</span>
          </div>
        </aside>

        <section v-if="selectedUsers.length" class="card permission-panel">
          <div class="permission-heading">
            <div class="selection-context">
              <div v-if="bulkMode" class="selection-avatar selection-avatar--bulk"><md-icon>groups</md-icon></div>
              <div v-else class="selection-avatar">
                <img v-if="selectedUser?.avatar" :src="selectedUser.avatar" alt="" />
                <md-icon v-else>account_circle</md-icon>
              </div>
              <div>
                <span class="section-overline">当前编辑对象</span>
                <h2 class="card-title">{{ panelTitle }}</h2>
                <p v-if="ownerSelected">初始所有者始终拥有全部可用权限。</p>
                <p v-else-if="bulkMode">未调整的项目将保持各用户原有权限。</p>
                <p v-else>{{ selectedUser?.username }}</p>
              </div>
            </div>
            <div class="permission-heading-actions">
              <md-text-button v-if="hasDraftChanges" :disabled="saving" @click="resetDrafts">
                <md-icon slot="icon">undo</md-icon>
                撤销修改
              </md-text-button>
              <md-filled-button v-if="canEditSelection" :disabled="saving || !hasDraftChanges" @click="savePermissions">
                <md-icon slot="icon">save</md-icon>
                {{ saving ? '保存中…' : bulkMode ? `保存 ${selectedUsers.length} 位用户` : '保存权限' }}
              </md-filled-button>
            </div>
          </div>

          <div class="permission-toolbar">
            <div class="permission-legend" aria-label="权限等级">
              <span><i class="permission-dot permission-dot--hidden"></i>隐藏</span>
              <span><i class="permission-dot permission-dot--view"></i>查看</span>
              <span><i class="permission-dot permission-dot--edit"></i>编辑</span>
            </div>
            <md-text-button v-if="expandableParentKeys.length" @click="toggleAllParents">
              <md-icon slot="icon">{{ allParentsExpanded ? 'unfold_less' : 'unfold_more' }}</md-icon>
              {{ allParentsExpanded ? '收起所有细分权限' : '展开所有细分权限' }}
            </md-text-button>
          </div>

          <div class="permission-section-heading">
            <div>
              <span class="section-overline">访问范围</span>
              <h3>页面权限</h3>
            </div>
            <span class="permission-section-count">{{ pages.length }} 个页面</span>
          </div>
          <div class="permission-list">
            <div v-if="accountFeatures.length" class="permission-parent">
              <div class="permission-row">
                <div class="permission-page-name">
                  <md-icon>account_circle</md-icon>
                  <span>
                    <strong>账户</strong>
                    <small>账户页始终可访问，可单独限制资料与密码操作</small>
                  </span>
                </div>
                <md-icon-button
                  :aria-label="isParentExpanded('account') ? '收起账户区域权限' : '展开账户区域权限'"
                  :title="isParentExpanded('account') ? '收起细分权限' : '细分权限'"
                  @click="toggleParent('account')"
                >
                  <Transition name="permission-icon" mode="out-in">
                    <md-icon :key="isParentExpanded('account') ? 'expanded' : 'collapsed'">{{ isParentExpanded('account') ? 'expand_less' : 'tune' }}</md-icon>
                  </Transition>
                </md-icon-button>
              </div>
              <Transition name="permission-expand">
                <div v-if="isParentExpanded('account')" class="permission-children">
                  <div v-for="feature in accountFeatures" :key="feature.key" class="permission-row permission-row--child">
                    <div class="permission-page-name">
                      <md-icon>{{ feature.icon }}</md-icon>
                      <span>
                        <strong>{{ feature.label.replace('账户：', '') }}</strong>
                        <small>{{ feature.description }}</small>
                      </span>
                    </div>
                    <div class="permission-options" role="group" :aria-label="`${feature.label}权限`">
                      <button v-for="option in featureOptions(feature)" :key="option" type="button" :aria-pressed="(ownerSelected ? 'edit' : featureDrafts[feature.key]) === option" :class="{ 'permission-option--active': (ownerSelected ? 'edit' : featureDrafts[feature.key]) === option }" :disabled="!canEditSelection" @click="setFeaturePermission(feature, option)">
                        {{ permissionLabel(option, true) }}
                      </button>
                    </div>
                  </div>
                </div>
              </Transition>
            </div>

            <div v-for="page in pages" :key="page.key" class="permission-parent">
              <div class="permission-row">
                <div class="permission-page-name">
                  <md-icon>{{ page.icon }}</md-icon>
                  <span>
                    <strong>{{ page.label }}</strong>
                    <small v-if="page.readOnly">此页面无修改操作</small>
                    <small v-else-if="page.key === 'settings'">新账户默认可查看</small>
                    <small v-else-if="page.maxNonOwnerLevel === 'hidden'">仅初始账户可查看和编辑</small>
                    <small v-else-if="page.key === 'permissions'">新账户默认隐藏，非所有者最多可查看</small>
                    <small v-else-if="page.key === 'server-manage'">新账户默认只可查看，细分权限需单独放开</small>
                    <small v-else-if="page.maxNonOwnerLevel === 'view'">非所有者仅可隐藏或查看</small>
                    <small v-else>新账户默认可编辑</small>
                  </span>
                </div>
                <div class="permission-row-actions">
                  <md-icon-button
                    v-if="featuresForParent(page.key).length"
                    :aria-label="isParentExpanded(page.key) ? `收起${page.label}区域权限` : `展开${page.label}区域权限`"
                    :title="isParentExpanded(page.key) ? '收起细分权限' : '细分权限'"
                    @click="toggleParent(page.key)"
                  >
                    <Transition name="permission-icon" mode="out-in">
                      <md-icon :key="isParentExpanded(page.key) ? 'expanded' : 'collapsed'">{{ isParentExpanded(page.key) ? 'expand_less' : 'tune' }}</md-icon>
                    </Transition>
                  </md-icon-button>
                  <div class="permission-options" role="group" :aria-label="`${page.label}权限`">
                    <button v-for="option in pageOptions(page)" :key="option" type="button" :aria-pressed="(ownerSelected ? (page.readOnly ? 'view' : 'edit') : drafts[page.key]) === option" :class="{ 'permission-option--active': (ownerSelected ? (page.readOnly ? 'view' : 'edit') : drafts[page.key]) === option }" :disabled="!canEditSelection" @click="setPermission(page, option)">
                      {{ permissionLabel(option) }}
                    </button>
                  </div>
                </div>
              </div>
              <Transition name="permission-expand">
                <div v-if="isParentExpanded(page.key)" class="permission-children">
                  <div v-for="feature in featuresForParent(page.key)" :key="feature.key" class="permission-row permission-row--child">
                    <div class="permission-page-name">
                      <md-icon>{{ feature.icon }}</md-icon>
                      <span>
                        <strong>{{ feature.label.replace(`${page.label}：`, '') }}</strong>
                        <small>{{ feature.description }}</small>
                      </span>
                    </div>
                    <div class="permission-options" role="group" :aria-label="`${feature.label}权限`">
                      <button v-for="option in featureOptions(feature)" :key="option" type="button" :aria-pressed="(ownerSelected ? 'edit' : featureDrafts[feature.key]) === option" :class="{ 'permission-option--active': (ownerSelected ? 'edit' : featureDrafts[feature.key]) === option }" :disabled="!canEditSelection" @click="setFeaturePermission(feature, option)">
                        {{ permissionLabel(option, true) }}
                      </button>
                    </div>
                  </div>
                </div>
              </Transition>
            </div>
          </div>
        </section>
        <section v-else class="card permission-empty-state">
          <md-icon>manage_accounts</md-icon>
          <h2>暂无可管理账户</h2>
          <p>请先在后台用户页面创建账户。</p>
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
  position: sticky;
  top: calc(var(--app-bar-height) + 16px);
  max-height: calc(100vh - var(--app-bar-height) - 48px);
  max-height: calc(100dvh - var(--app-bar-height) - 48px);
  display: grid;
  gap: 4px;
  padding: 8px;
  overflow-y: auto;
}

.user-option {
  width: 100%;
  min-height: 52px;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 40px;
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

.user-option .user-selection {
  justify-self: end;
  pointer-events: none;
}

.user-option > md-icon.user-selection {
  color: var(--md-sys-color-primary);
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

.permission-section-title {
  margin: 24px 0 0;
  font-size: 15px;
  font-weight: 600;
}

.permission-heading + .permission-section-title {
  margin-top: 8px;
}

.permission-section-note {
  margin: 6px 0 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}

.permission-row {
  min-height: 68px;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding: 10px 0;
}

.permission-parent + .permission-parent {
  border-top: 1px solid var(--md-sys-color-outline-variant);
}

.permission-children {
  border-top: 1px dashed var(--md-sys-color-outline-variant);
  border-radius: 6px;
  overflow: hidden;
}

.permission-row--child {
  min-height: 60px;
  padding: 8px 12px 8px 34px;
  background: color-mix(in srgb, var(--md-sys-color-surface-container) 68%, transparent);
}

.permission-row--child + .permission-row--child {
  border-top: 1px dashed var(--md-sys-color-outline-variant);
}

.permission-row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.permission-icon-enter-active,
.permission-icon-leave-active {
  transition: opacity 140ms ease, transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.permission-icon-enter-from,
.permission-icon-leave-to {
  opacity: 0;
  transform: rotate(-35deg) scale(0.75);
}

.permission-expand-enter-active,
.permission-expand-leave-active {
  max-height: 520px;
  opacity: 1;
  transform: translateY(0);
  overflow: hidden;
  transition: max-height 240ms cubic-bezier(0.2, 0, 0, 1), opacity 180ms ease, transform 240ms cubic-bezier(0.2, 0, 0, 1);
}

.permission-expand-enter-from,
.permission-expand-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-8px);
}

.permission-row > md-icon-button {
  justify-self: end;
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
  transition:
    background-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard),
    color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard);
}

.permission-options button:hover:not(:disabled):not(.permission-option--active) {
  background: color-mix(in srgb, var(--md-sys-color-on-surface) var(--md-sys-state-hover-state-layer-opacity), transparent);
}

.permission-options button:last-child {
  border-right: 0;
}

.permission-options button:disabled {
  cursor: default;
  opacity: var(--md-sys-state-disabled-content-opacity);
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
    position: static;
    max-height: none;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    overflow: visible;
  }

  .permission-row {
    grid-template-columns: 1fr;
  }

  .permission-row--child {
    padding-left: 18px;
  }

  .permission-row-actions {
    width: 100%;
  }

  .permission-options {
    width: 100%;
    grid-auto-columns: 1fr;
  }

  .permission-row-actions .permission-options {
    flex: 1;
  }

  .permission-heading md-filled-button {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .user-list {
    grid-template-columns: minmax(0, 1fr);
  }

  .permission-row-actions {
    align-items: flex-start;
  }

  .permission-options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-flow: row;
    grid-auto-columns: auto;
    gap: 1px;
    background: var(--md-sys-color-outline-variant);
  }

  .permission-options button,
  .permission-options button:last-child {
    min-width: 0;
    border: 0;
    background: var(--md-sys-color-surface-container);
    padding: 0 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .permission-icon-enter-active,
  .permission-icon-leave-active,
  .permission-expand-enter-active,
  .permission-expand-leave-active {
    transition-duration: 1ms;
  }
}

/* 权限工作台：桌面端强调账户与权限矩阵的并行浏览，窄屏改为上下流程。 */
.permissions-page {
  --permission-panel-border: color-mix(in srgb, var(--md-sys-color-outline-variant) 78%, transparent);
}

.permissions-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--permission-panel-border);
}

.permissions-title-block {
  min-width: 0;
}

.permissions-eyebrow,
.section-overline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--md-sys-color-primary);
  font-size: 11px;
  font-weight: 700;
}

.permissions-eyebrow md-icon {
  --md-icon-size: 16px;
}

.permissions-title-block .page-title {
  margin: 6px 0 4px;
}

.permissions-title-block p {
  max-width: 560px;
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
}

.permissions-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.permissions-stats {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--permission-panel-border);
  border-radius: 8px;
  background: var(--md-sys-color-surface-container);
}

.permission-stat {
  min-width: 74px;
  display: grid;
  gap: 2px;
  padding: 9px 13px;
  border-right: 1px solid var(--permission-panel-border);
}

.permission-stat:last-child {
  border-right: 0;
}

.permission-stat strong {
  color: var(--md-sys-color-on-surface);
  font-size: 18px;
  line-height: 1.1;
}

.permission-stat span,
.permission-section-count,
.user-count {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 10px;
  white-space: nowrap;
}

.permission-loading,
.permission-empty-state {
  min-height: 280px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: var(--md-sys-color-on-surface-variant);
  text-align: center;
}

.permission-loading md-circular-progress {
  width: 32px;
  height: 32px;
}

.permission-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.user-list,
.permission-panel,
.permission-empty-state {
  min-width: 0;
  border: 1px solid var(--permission-panel-border);
  box-shadow: var(--md-sys-elevation-level1);
}

.user-list {
  position: sticky;
  top: calc(var(--app-bar-height) + 16px);
  max-height: calc(100vh - var(--app-bar-height) - 48px);
  max-height: calc(100dvh - var(--app-bar-height) - 48px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  overflow: hidden;
  overflow-x: hidden;
}

.user-list-header,
.permission-section-heading {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.user-list-header-actions {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.bulk-selection-button {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
}

.user-list-header h2,
.permission-section-heading h3 {
  margin: 4px 0 0;
  color: var(--md-sys-color-on-surface);
  font-size: 14px;
  font-weight: 700;
}

.user-count,
.permission-section-count {
  padding: 4px 7px;
  border-radius: 5px;
  background: var(--md-sys-color-surface-container-high);
}

.user-search {
  min-width: 0;
  max-width: 100%;
  width: 100%;
}

.user-options {
  flex: 1;
  min-height: 0;
  display: grid;
  gap: 4px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
}

.user-option {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 64px;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 8px 9px;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard);
}

.user-option:hover {
  border-color: var(--permission-panel-border);
  background: var(--md-sys-color-surface-container);
}

.user-option--active {
  border-color: color-mix(in srgb, var(--md-sys-color-primary) 35%, transparent);
  background: var(--md-sys-color-secondary-container);
}

.user-avatar,
.selection-avatar {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  flex: 0 0 36px;
  overflow: hidden;
  border-radius: 50%;
  color: var(--md-sys-color-primary);
  background: var(--md-sys-color-primary-container);
}

.user-avatar img,
.selection-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-avatar md-icon,
.selection-avatar md-icon {
  --md-icon-size: 22px;
}

.user-copy,
.permission-page-name > span {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.user-copy strong,
.user-copy small,
.permission-page-name strong,
.permission-page-name small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-copy strong,
.permission-page-name strong {
  color: var(--md-sys-color-on-surface);
  font-size: 12px;
}

.user-copy small,
.permission-page-name small {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 10px;
}

.user-option .user-meta {
  min-width: 0;
  max-width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
}

.user-role {
  display: none;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 9px;
  white-space: nowrap;
}

.user-role--owner {
  display: inline-flex;
  color: var(--md-sys-color-primary);
}

.user-role--inactive {
  display: inline-flex;
  color: var(--md-sys-color-error);
}

.user-selection {
  pointer-events: none;
}

.user-meta > md-icon.user-selection {
  --md-icon-size: 18px;
  color: var(--md-sys-color-primary);
}

.user-meta > md-icon.user-selection[title] {
  cursor: default;
}

.user-filter-empty {
  min-height: 100px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 6px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 11px;
  text-align: center;
}

.user-filter-empty md-icon,
.permission-empty-state > md-icon {
  --md-icon-size: 28px;
}

.permission-panel {
  padding: 24px;
  overflow: hidden;
}

.permission-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--permission-panel-border);
}

.permission-heading p {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 11px;
}

.selection-context {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.selection-avatar {
  width: 44px;
  height: 44px;
  flex-basis: 44px;
}

.selection-avatar--bulk {
  color: var(--md-sys-color-on-secondary-container);
  background: var(--md-sys-color-secondary-container);
}

.selection-avatar md-icon {
  --md-icon-size: 25px;
}

.permission-heading .card-title {
  margin: 4px 0 3px;
  font-size: 20px;
}

.permission-heading-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}

.permission-toolbar {
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--permission-panel-border);
}

.permission-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 10px;
}

.permission-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.permission-dot {
  width: 7px;
  height: 7px;
  display: inline-block;
  border-radius: 50%;
  background: var(--md-sys-color-outline);
}

.permission-dot--view {
  background: var(--md-sys-color-secondary);
}

.permission-dot--edit {
  background: var(--md-sys-color-primary);
}

.permission-section-heading {
  padding: 20px 0 10px;
}

.permission-list {
  display: grid;
  margin-top: 0;
  border-top: 1px solid var(--permission-panel-border);
}

.permission-parent + .permission-parent {
  border-top: 1px solid var(--permission-panel-border);
}

.permission-row {
  min-width: 0;
  min-height: 68px;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto;
  align-items: center;
  gap: 18px;
  padding: 12px 0;
}

.permission-page-name {
  min-width: 0;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.permission-page-name > md-icon {
  --md-icon-size: 21px;
  color: var(--md-sys-color-primary);
}

.permission-row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.permission-children {
  margin: 0 0 8px 40px;
  border-top: 0;
  border-left: 2px solid var(--permission-panel-border);
  border-radius: 0;
  overflow: hidden;
}

.permission-row--child {
  min-height: 56px;
  padding: 8px 12px 8px 14px;
  background: color-mix(in srgb, var(--md-sys-color-surface-container) 54%, transparent);
}

.permission-row--child + .permission-row--child {
  border-top: 1px dashed var(--permission-panel-border);
}

.permission-options {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(64px, auto);
  border: 1px solid var(--md-sys-color-outline);
  border-radius: 7px;
  overflow: hidden;
  background: var(--md-sys-color-surface);
}

.permission-options button {
  min-height: 34px;
  border: 0;
  border-right: 1px solid var(--md-sys-color-outline-variant);
  padding: 0 12px;
  color: var(--md-sys-color-on-surface-variant);
  background: transparent;
  font: inherit;
  font-size: 10px;
  cursor: pointer;
  transition:
    background-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard),
    color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard);
}

.permission-options .permission-option--active {
  color: var(--md-sys-color-on-secondary-container);
  background: var(--md-sys-color-secondary-container);
  font-weight: 700;
}

.permission-empty-state {
  min-height: 360px;
  padding: 24px;
}

@media (max-width: 1100px) {
  .permission-layout {
    grid-template-columns: 240px minmax(0, 1fr);
    gap: 16px;
  }

  .permission-panel {
    padding: 20px;
  }

  .permission-row {
    gap: 12px;
  }
}

@media (max-width: 760px) {
  .permissions-header {
    align-items: stretch;
    flex-direction: column;
    gap: 16px;
  }

  .permissions-header-actions {
    justify-content: space-between;
  }

  .permissions-stats {
    flex: 1;
  }

  .permission-stat {
    flex: 1;
  }

  .permission-layout {
    grid-template-columns: 1fr;
  }

  .user-list {
    position: static;
    max-height: none;
    overflow: hidden;
  }

  .user-options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: visible;
    overflow-x: hidden;
  }

  .user-role {
    display: none;
  }

  .permission-heading {
    flex-direction: column;
    align-items: stretch;
  }

  .permission-heading-actions {
    justify-content: flex-end;
  }

  .permission-toolbar {
    min-height: 48px;
  }

  .permission-row {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .permission-row-actions {
    width: 100%;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
  }

  .permission-row-actions .permission-options {
    width: 100%;
  }

  .permission-options {
    grid-auto-columns: 1fr;
  }

  .permission-children {
    margin-left: 20px;
  }
}

@media (max-width: 480px) {
  .permissions-header-actions {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .permissions-stats {
    min-width: 0;
  }

  .permission-stat {
    min-width: 0;
    padding-inline: 9px;
  }

  .permission-stat strong {
    font-size: 16px;
  }

  .user-options {
    grid-template-columns: 1fr;
  }

  .user-list-header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .user-list-header-actions {
    flex-wrap: wrap;
  }

  .permission-panel {
    padding: 16px;
  }

  .permission-heading-actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .permission-heading-actions md-filled-button,
  .permission-heading-actions md-text-button {
    width: 100%;
  }

  .permission-toolbar {
    align-items: flex-start;
    flex-direction: column;
    padding: 10px 0;
  }

  .permission-section-heading {
    align-items: flex-start;
  }

  .permission-page-name {
    grid-template-columns: 26px minmax(0, 1fr);
    gap: 8px;
  }

  .permission-page-name small {
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .permission-row-actions {
    grid-template-columns: 1fr;
  }

  .permission-row-actions > md-icon-button {
    justify-self: end;
    margin-bottom: -6px;
  }

  .permission-options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-flow: row;
    grid-auto-columns: auto;
    gap: 1px;
    border: 0;
    background: var(--md-sys-color-outline-variant);
  }

  .permission-options button,
  .permission-options button:last-child {
    min-width: 0;
    border: 0;
    background: var(--md-sys-color-surface);
    padding: 0 8px;
  }

  .permission-options .permission-option--active {
    background: var(--md-sys-color-secondary-container);
  }
}

@media (prefers-reduced-motion: reduce) {
  .user-option,
  .permission-options button {
    transition-duration: 1ms;
  }
}
</style>
