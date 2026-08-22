<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import type { ThemeMode } from '../composables/useThemeTransition'

const route = useRoute()

const baseNavItems = [
  { label: '仪表盘', icon: 'dashboard', to: '/' },
  { label: '服务器动态', icon: 'monitoring', to: '/activity' },
  { label: '聊天区', icon: 'forum', to: '/chat' },
  { label: '捐赠列表', icon: 'redeem', to: '/donors' },
  { label: '封禁列表', icon: 'gavel', to: '/bans' },
  { label: '更新服务', icon: 'system_update', to: '/updates' },
  { label: '游戏账户', icon: 'manage_accounts', to: '/game-accounts' }
]
interface CurrentUser {
  username: string
  avatar: string
  fullName: string
  isOwner: boolean
}

const currentUser = ref<CurrentUser | null>(null)
const accountLabel = computed(() => currentUser.value?.fullName || currentUser.value?.username || '账户')
const navItems = computed(() => [
  ...baseNavItems,
  { label: '操作记录', icon: 'history', to: '/audit-logs' },
  ...(currentUser.value?.isOwner ? [{ label: '后台用户', icon: 'manage_accounts', to: '/admin-users' }] : []),
])

const drawerOpen = ref(true)
const isDesktop = ref(true)
const dark = ref(false)
const themeMode = ref<ThemeMode>('system')
const { toggleTheme, themeIcon, themeModeLabel, themeButtonLabel } = useThemeTransition(dark, themeMode)

const { load: loadEntry } = useEntry()

const mq = typeof window !== 'undefined' ? window.matchMedia('(min-width: 900px)') : null

function syncDrawer() {
  isDesktop.value = mq ? mq.matches : true
  drawerOpen.value = isDesktop.value
}

function onNav(e: Event, to: string) {
  e.preventDefault()
  if (!isDesktop.value) drawerOpen.value = false
  navigateTo(to)
}

function onDrawerChanged(e: Event) {
  drawerOpen.value = (e as CustomEvent<{ opened: boolean }>).detail.opened
}

function isActive(to: string) {
  return route.path === to
}

function onProfileUpdated(event: Event) {
  const user = (event as CustomEvent<CurrentUser>).detail
  if (user?.username) currentUser.value = user
}

onMounted(async () => {
  syncDrawer()
  mq?.addEventListener('change', syncDrawer)
  window.addEventListener('admin-profile-updated', onProfileUpdated)
  try {
    const result = await $fetch<{ user: CurrentUser }>('/api/auth/me')
    currentUser.value = result.user
  } catch {
    const entry = await loadEntry()
    await navigateTo('/' + entry)
  }
})

onBeforeUnmount(() => {
  mq?.removeEventListener('change', syncDrawer)
  window.removeEventListener('admin-profile-updated', onProfileUpdated)
})
</script>

<template>
  <div class="shell">
    <header class="app-bar">
      <md-icon-button class="menu-button" aria-label="菜单" @click="drawerOpen = !drawerOpen">
        <md-icon>menu</md-icon>
      </md-icon-button>
      <img class="app-logo" src="/images/uzw-tm.png" alt="悠哉世界" />
      <div class="app-bar-actions">
        <md-icon-button :aria-label="themeButtonLabel" :title="themeModeLabel" @click="toggleTheme">
          <Transition name="icon-swap" mode="out-in">
            <md-icon :key="themeIcon">{{ themeIcon }}</md-icon>
          </Transition>
        </md-icon-button>
      </div>
    </header>

    <div class="body">
      <div
        v-if="isDesktop"
        class="desktop-nav-shell"
        :class="{ 'desktop-nav-shell--collapsed': !drawerOpen }"
      >
        <Transition name="desktop-nav-content" mode="out-in">
          <md-navigation-drawer
            v-if="drawerOpen"
            key="expanded"
            :opened="drawerOpen"
            pivot="start"
            @navigation-drawer-changed="onDrawerChanged"
          >
            <div class="drawer-content">
              <md-list class="nav-list">
                <md-list-item
                  v-for="item in navItems"
                  :key="item.to"
                  type="link"
                  :href="item.to"
                  :class="{ 'nav-item--active': isActive(item.to) }"
                  @click="onNav($event, item.to)"
                >
                  <md-icon slot="start" :class="{ 'icon--active': isActive(item.to) }">{{ item.icon }}</md-icon>
                  <span slot="headline" :class="{ 'label--active': isActive(item.to) }">{{ item.label }}</span>
                </md-list-item>
              </md-list>
              <md-list-item
                type="link"
                href="/account"
                :class="{ 'nav-item--active': isActive('/account') }"
                @click="onNav($event, '/account')"
                class="logout-item"
              >
                <img v-if="currentUser?.avatar" slot="start" class="nav-account-avatar" :src="currentUser.avatar" alt="" />
                <md-icon v-else slot="start" :class="{ 'icon--active': isActive('/account') }">account_circle</md-icon>
                <span slot="headline" :class="{ 'label--active': isActive('/account') }">{{ accountLabel }}</span>
              </md-list-item>
            </div>
          </md-navigation-drawer>

          <aside v-else key="collapsed" class="desktop-collapsed-nav">
            <nav class="collapsed-nav-list" aria-label="主导航">
              <md-icon-button
                v-for="item in navItems"
                :key="item.to"
                :aria-label="item.label"
                :title="item.label"
                :class="{ 'collapsed-nav-item--active': isActive(item.to) }"
                @click="onNav($event, item.to)"
              >
                <md-icon>{{ item.icon }}</md-icon>
              </md-icon-button>
            </nav>
            <md-icon-button
              :aria-label="accountLabel"
              :title="accountLabel"
              :class="{ 'collapsed-nav-item--active': isActive('/account') }"
              @click="onNav($event, '/account')"
            >
              <img v-if="currentUser?.avatar" class="collapsed-account-avatar" :src="currentUser.avatar" alt="" />
              <md-icon v-else>account_circle</md-icon>
            </md-icon-button>
          </aside>
        </Transition>
      </div>

      <md-navigation-drawer-modal
        v-if="!isDesktop"
        :opened="drawerOpen"
        pivot="start"
        :class="{ 'drawer-modal--open': drawerOpen }"
        @navigation-drawer-changed="onDrawerChanged"
      >
        <div class="drawer-content">
          <md-list class="nav-list">
            <md-list-item
              v-for="item in navItems"
              :key="item.to"
              type="link"
              :href="item.to"
              :class="{ 'nav-item--active': isActive(item.to) }"
              @click="onNav($event, item.to)"
            >
              <md-icon slot="start" :class="{ 'icon--active': isActive(item.to) }">{{ item.icon }}</md-icon>
              <span slot="headline" :class="{ 'label--active': isActive(item.to) }">{{ item.label }}</span>
            </md-list-item>
          </md-list>
          <md-list-item
            type="link"
            href="/account"
            :class="{ 'nav-item--active': isActive('/account') }"
            @click="onNav($event, '/account')"
            class="logout-item"
          >
            <img v-if="currentUser?.avatar" slot="start" class="nav-account-avatar" :src="currentUser.avatar" alt="" />
            <md-icon v-else slot="start" :class="{ 'icon--active': isActive('/account') }">account_circle</md-icon>
            <span slot="headline" :class="{ 'label--active': isActive('/account') }">{{ accountLabel }}</span>
          </md-list-item>
        </div>
      </md-navigation-drawer-modal>

      <main class="content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
}

.app-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  height: 64px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  background: var(--md-sys-color-surface-container);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.app-bar-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.app-logo {
  display: block;
  width: 156px;
  height: 40px;
  object-fit: contain;
  object-position: left center;
}

.nav-account-avatar,
.collapsed-account-avatar {
  border-radius: 50%;
  object-fit: cover;
}

.nav-account-avatar {
  width: 24px;
  height: 24px;
}

.icon-swap-enter-active,
.icon-swap-leave-active {
  transition: opacity 140ms ease, transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.icon-swap-enter-from,
.icon-swap-leave-to {
  opacity: 0;
  transform: rotate(-35deg) scale(0.75);
}

.body {
  display: flex;
  min-height: 100vh;
  padding-top: 64px;
}

.desktop-nav-shell {
  width: 256px;
  flex: 0 0 auto;
  position: sticky;
  top: 64px;
  align-self: flex-start;
  height: calc(100vh - 64px);
  overflow: hidden;
  background: var(--md-sys-color-surface-container);
  border-right: 1px solid var(--md-sys-color-outline-variant);
  transition: width 240ms cubic-bezier(0.2, 0, 0, 1);
}

.desktop-nav-shell--collapsed {
  width: 72px;
}

.desktop-nav-shell md-navigation-drawer {
  width: 100%;
  height: 100%;
  --md-navigation-drawer-container-width: 100%;
  --md-navigation-drawer-container-color: var(--md-sys-color-surface-container);
  --md-navigation-drawer-divider-color: transparent;
}

.desktop-nav-content-enter-active,
.desktop-nav-content-leave-active {
  transition: opacity 140ms ease, transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.desktop-nav-content-enter-from {
  opacity: 0;
  transform: translateX(-8px);
}

.desktop-nav-content-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

.desktop-collapsed-nav {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
  background: var(--md-sys-color-surface-container);
}

.desktop-collapsed-nav md-icon-button {
  flex: 0 0 auto;
  transition: color 160ms ease, transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.desktop-collapsed-nav md-icon-button:hover {
  transform: scale(1.08);
}

.collapsed-nav-list {
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.collapsed-nav-item--active {
  color: var(--md-sys-color-primary);
  --md-icon-button-state-layer-color: var(--md-sys-color-primary);
}

.collapsed-nav-item--active md-icon {
  font-variation-settings: 'FILL' 1;
}

.collapsed-account-avatar {
  width: 24px;
  height: 24px;
}

md-navigation-drawer-modal {
  position: fixed;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  --md-navigation-drawer-modal-container-width: 256px;
  --md-navigation-drawer-modal-container-color: var(--md-sys-color-surface-container);
  --md-navigation-drawer-modal-scrim-color: #000;
  --md-navigation-drawer-modal-scrim-opacity: 0.32;
}

md-navigation-drawer-modal.drawer-modal--open {
  pointer-events: auto;
}

.drawer-content {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.nav-list {
  flex: 1;
  padding-top: 8px;
}

.logout-item {
  margin-bottom: 8px;
}

.icon--active {
  color: var(--md-sys-color-primary);
  font-variation-settings: 'FILL' 1;
}

.label--active {
  color: var(--md-sys-color-primary);
  font-weight: 600;
}

md-list {
  --md-list-container-color: transparent;
}

.content {
  flex: 1;
  min-width: 0;
  overflow-x: hidden;
  background: var(--md-sys-color-surface);
}

@media (max-width: 899px) {
  .app-bar {
    height: 56px;
    padding: 0 8px;
  }

  .body {
    padding-top: 56px;
  }

  .app-logo {
    width: 128px;
    height: 32px;
  }

  md-navigation-drawer-modal {
    --md-navigation-drawer-modal-container-width: min(320px, calc(100vw - 40px));
  }
}
</style>
