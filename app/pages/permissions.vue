<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type {
  AdminFeatureDefinition,
  AdminFeaturePermissionLevel,
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
const selectedUserId = ref<number | null>(null)
const drafts = ref<Record<string, AdminPagePermissionLevel>>({})
const featureDrafts = ref<Record<string, AdminFeaturePermissionLevel>>({})
const expandedParents = ref<Set<string>>(new Set())
const loading = ref(true)
const saving = ref(false)

const selectedUser = computed(() => users.value.find((user) => user.id === selectedUserId.value) || null)
const canManage = computed(() => access.user.value?.isOwner === true)
const accountFeatures = computed(() => features.value.filter((feature) => feature.parentKey === 'account'))

function selectUser(user: PermissionUser) {
  selectedUserId.value = user.id
  drafts.value = { ...user.permissions }
  featureDrafts.value = { ...user.featurePermissions }
}

function setPermission(page: AdminPageDefinition, level: AdminPagePermissionLevel) {
  if (!canManage.value || selectedUser.value?.isOwner) return
  const nextLevel = page.maxNonOwnerLevel === 'hidden'
    ? 'hidden'
    : page.maxNonOwnerLevel === 'view' && level === 'edit'
      ? 'view'
      : level
  drafts.value[page.key] = nextLevel
  for (const feature of features.value) {
    if (feature.pageKey !== page.key) continue
    if (nextLevel === 'hidden') featureDrafts.value[feature.key] = 'hidden'
    else if (nextLevel === 'view' && featureDrafts.value[feature.key] === 'edit') featureDrafts.value[feature.key] = 'view'
  }
}

function featureOptions(feature: AdminFeatureDefinition): AdminFeaturePermissionLevel[] {
  if (selectedUser.value?.isOwner) return ['edit']
  const options = feature.availableLevels || ['hidden', 'view', 'edit']
  const pageLevel = feature.pageKey ? drafts.value[feature.pageKey] || 'hidden' : 'edit'
  if (pageLevel === 'hidden') return ['hidden']
  if (pageLevel === 'view') return options.filter((level) => level !== 'edit')
  return feature.maxNonOwnerLevel === 'hidden'
    ? ['hidden']
    : feature.maxNonOwnerLevel === 'view'
      ? options.filter((level) => level !== 'edit')
      : options
}

function setFeaturePermission(feature: AdminFeatureDefinition, level: AdminFeaturePermissionLevel) {
  if (!canManage.value || selectedUser.value?.isOwner || !featureOptions(feature).includes(level)) return
  featureDrafts.value[feature.key] = level
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

async function loadPermissions() {
  loading.value = true
  try {
    const result = await $fetch<PermissionResponse>('/api/admin/permissions')
    pages.value = result.pages
    features.value = result.features
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
      body: {
        permissions: drafts.value,
        featurePermissions: featureDrafts.value,
      },
    })
    const index = users.value.findIndex((item) => item.id === updated.id)
    if (index >= 0) users.value[index] = updated
    drafts.value = { ...updated.permissions }
    featureDrafts.value = { ...updated.featurePermissions }
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
  <div class="page permissions-page">
    <div class="page-heading">
      <div>
        <h1 class="page-title">权限管理</h1>
        <p class="page-subtitle">为每个后台账户设置页面权限与敏感区域权限。</p>
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

          <h3 class="permission-section-title">页面权限</h3>
          <p class="permission-section-note">父页面右侧的细分按钮可展开区域权限；页面权限会限制其区域权限上限。</p>
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
                      <button v-for="option in featureOptions(feature)" :key="option" type="button" :class="{ 'permission-option--active': (selectedUser.isOwner ? 'edit' : featureDrafts[feature.key]) === option }" :disabled="!canManage || selectedUser.isOwner" @click="setFeaturePermission(feature, option)">
                        {{ option === 'hidden' ? '隐藏' : option === 'view' ? '查看' : '修改' }}
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
                    <small v-if="page.key === 'settings'">新账户默认可查看</small>
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
                    <button v-for="option in (selectedUser.isOwner ? ['edit'] : page.maxNonOwnerLevel === 'hidden' ? ['hidden'] : page.maxNonOwnerLevel === 'view' ? ['hidden', 'view'] : ['hidden', 'view', 'edit'])" :key="option" type="button" :class="{ 'permission-option--active': (selectedUser.isOwner ? 'edit' : drafts[page.key]) === option }" :disabled="!canManage || selectedUser.isOwner" @click="setPermission(page, option as AdminPagePermissionLevel)">
                      {{ option === 'hidden' ? '隐藏' : option === 'view' ? '查看' : '编辑' }}
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
                      <button v-for="option in featureOptions(feature)" :key="option" type="button" :class="{ 'permission-option--active': (selectedUser.isOwner ? 'edit' : featureDrafts[feature.key]) === option }" :disabled="!canManage || selectedUser.isOwner" @click="setFeaturePermission(feature, option)">
                        {{ option === 'hidden' ? '隐藏' : option === 'view' ? '查看' : '修改' }}
                      </button>
                    </div>
                  </div>
                </div>
              </Transition>
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

@media (prefers-reduced-motion: reduce) {
  .permission-icon-enter-active,
  .permission-icon-leave-active,
  .permission-expand-enter-active,
  .permission-expand-leave-active {
    transition-duration: 1ms;
  }
}
</style>
