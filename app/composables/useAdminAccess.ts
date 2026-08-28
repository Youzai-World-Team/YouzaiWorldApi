import { computed } from 'vue'
import {
  ADMIN_FEATURE_DEFINITIONS,
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
    if (!key) return 'hidden'
    const current = user.value
    if (!current) return 'hidden'
    if (key === 'admin-users' && !current.isOwner) return 'hidden'
    const stored = current.permissions?.[key]
    if (stored) return stored
    const page = ADMIN_PAGE_DEFINITIONS.find((item) => item.key === key)
    if (!page) return 'hidden'
    return current.isOwner ? (page.readOnly ? 'view' : 'edit') : page.defaultLevel
  }

  function levelForPath(path: string): AdminPagePermissionLevel {
    const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path
    if (normalized === '/account') return 'edit'
    return levelForKey(adminPageKeyForPath(normalized))
  }

  function featureLevelForKey(key: string): AdminFeaturePermissionLevel {
    const current = user.value
    if (!current) return 'hidden'
    const stored = current.featurePermissions?.[key]
    if (stored) return stored
    const feature = ADMIN_FEATURE_DEFINITIONS.find((item) => item.key === key)
    if (!feature) return 'hidden'
    if (current.isOwner) return 'edit'
    const pageLevel = feature.pageKey ? levelForKey(feature.pageKey) : 'edit'
    if (pageLevel === 'hidden') return 'hidden'
    if (pageLevel === 'view' && feature.defaultLevel === 'edit') {
      return (feature.availableLevels || ['hidden', 'view', 'edit']).includes('view') ? 'view' : 'hidden'
    }
    return feature.defaultLevel
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
    firstVisibleRoute: computed(() => firstVisibleAdminRoute(Object.fromEntries(
      ADMIN_PAGE_DEFINITIONS.map((page) => [page.key, levelForKey(page.key)]),
    ))),
  }
}
