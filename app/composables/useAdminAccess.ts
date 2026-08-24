import { computed } from 'vue'
import {
  ADMIN_PAGE_DEFINITIONS,
  adminPageKeyForPath,
  firstVisibleAdminRoute,
  type AdminFeaturePermissionLevel,
  type AdminPagePermissionLevel,
} from '#shared/admin-page-permissions'

export interface AdminAccessUser {
  id: number
  username: string
  avatar: string
  fullName: string
  isOwner: boolean
  isActive: boolean
  createdAt: number
  permissions: Record<string, AdminPagePermissionLevel>
  featurePermissions: Record<string, AdminFeaturePermissionLevel>
}

let accessLoadPromise: Promise<AdminAccessUser> | null = null

export function useAdminAccess() {
  const user = useState<AdminAccessUser | null>('admin-access-user', () => null)

  async function load(force = false) {
    if (user.value && !force) return user.value
    if (!accessLoadPromise) {
      accessLoadPromise = $fetch<{ user: AdminAccessUser }>('/api/auth/me')
        .then((result) => {
          user.value = result.user
          return result.user
        })
        .finally(() => {
          accessLoadPromise = null
        })
    }
    return accessLoadPromise
  }

  function clear() {
    user.value = null
  }

  function updateProfile(profile: Partial<AdminAccessUser>) {
    if (user.value) user.value = { ...user.value, ...profile }
  }

  function levelForKey(key: string | undefined): AdminPagePermissionLevel {
    if (!key) return 'edit'
    if (key === 'admin-users' && user.value && !user.value.isOwner) return 'hidden'
    return user.value?.permissions?.[key] || 'hidden'
  }

  function levelForPath(path: string): AdminPagePermissionLevel {
    return levelForKey(adminPageKeyForPath(path))
  }

  function featureLevelForKey(key: string): AdminFeaturePermissionLevel {
    return user.value?.featurePermissions?.[key] || 'hidden'
  }

  return {
    user,
    pages: ADMIN_PAGE_DEFINITIONS,
    load,
    clear,
    updateProfile,
    levelForKey,
    levelForPath,
    featureLevelForKey,
    firstVisibleRoute: computed(() => firstVisibleAdminRoute(user.value?.permissions || {})),
  }
}
