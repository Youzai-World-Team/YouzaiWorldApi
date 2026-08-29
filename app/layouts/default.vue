<script setup lang="ts">
import { computed, nextTick, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { adminPageKeyForPath, adminPagePermissionNotice } from '#shared/admin-page-permissions'
import type { ThemeMode } from '../composables/useThemeTransition'

const route = useRoute()

const access = useAdminAccess()
const currentUser = access.user
const domainMailUnread = useDomainMailUnread()
const hasUnreadDomainMail = computed(() => (domainMailUnread.count.value ?? 0) > 0)
const accountLabel = computed(() => currentUser.value?.fullName || currentUser.value?.username || '账户')
const navItems = computed(() => access.pages
  .filter((page) => access.levelForKey(page.key) !== 'hidden')
  .map((page) => ({ ...page, to: page.route })))
const currentPageKey = computed(() => adminPageKeyForPath(route.path))
const permissionNotice = computed(() => {
  const pageKey = currentPageKey.value
  return adminPagePermissionNotice(
    pageKey,
    access.levelForKey(pageKey),
    currentUser.value?.featurePermissions,
  )
})

const drawerOpen = ref(true)
const isDesktop = ref(true)
const dark = ref(false)
const themeMode = ref<ThemeMode>('system')
const { toggleTheme, themeIcon, themeModeLabel, themeButtonLabel } = useThemeTransition(dark, themeMode)

const desktopNavList = ref<HTMLElement | null>(null)
const collapsedNavList = ref<HTMLElement | null>(null)
const mobileNavList = ref<HTMLElement | null>(null)

const { load: loadEntry } = useEntry()

const mq = typeof window !== 'undefined' ? window.matchMedia('(min-width: 900px)') : null
let unreadRefreshTimer: ReturnType<typeof setInterval> | undefined
let presenceHeartbeatTimer: ReturnType<typeof setInterval> | undefined

function syncDrawer() {
  isDesktop.value = mq ? mq.matches : true
  drawerOpen.value = isDesktop.value
}

async function onNav(e: Event, to: string) {
  e.preventDefault()
  if (!isDesktop.value) {
    drawerOpen.value = false
    await nextTick()
  }
  await navigateTo(to)
}

function onDrawerChanged(e: Event) {
  const opened = (e as CustomEvent<{ opened: boolean }>).detail.opened
  // Opening is controlled by the menu button. Ignore delayed "opened" events
  // so they cannot reopen the mobile drawer after a navigation item was chosen.
  if (!opened) drawerOpen.value = false
}

function isActive(to: string) {
  return route.path === to
}

function itemHasUnread(itemKey: string) {
  return itemKey === 'domain-mail' && hasUnreadDomainMail.value
}

async function refreshDomainMailUnread() {
  if (access.levelForKey('domain-mail') === 'hidden') {
    domainMailUnread.setCount(0)
    return
  }
  try {
    await domainMailUnread.load(true)
  } catch {
    // 导航提醒失败不应影响后台页面本身；下一次轮询或页面刷新会重试。
  }
}

async function heartbeatAdminPresence() {
  if (document.hidden || !access.user.value) return
  try {
    await $fetch('/api/auth/presence', {
      method: 'POST',
      body: { path: route.path },
    })
  } catch {
    // 在线状态是辅助信息；短暂失败交给下一轮心跳恢复。
  }
}

function onVisibilityChange() {
  if (!document.hidden) {
    refreshDomainMailUnread()
    heartbeatAdminPresence()
  }
}

function onProfileUpdated(event: Event) {
  const user = (event as CustomEvent<{ username: string }>).detail
  if (user?.username) access.updateProfile(user)
}

onMounted(async () => {
  syncDrawer()
  mq?.addEventListener('change', syncDrawer)
  window.addEventListener('admin-profile-updated', onProfileUpdated)
  try {
    // 权限定义可能随版本新增，挂载布局时刷新快照，避免旧 useState 隐藏新页面。
    await access.load(true)
    await refreshDomainMailUnread()
    await heartbeatAdminPresence()
    unreadRefreshTimer = window.setInterval(() => {
      if (!document.hidden) refreshDomainMailUnread()
    }, 60_000)
    presenceHeartbeatTimer = window.setInterval(heartbeatAdminPresence, 25_000)
    document.addEventListener('visibilitychange', onVisibilityChange)
  } catch {
    const entry = await loadEntry()
    await navigateTo('/' + entry)
  }
})

onBeforeUnmount(() => {
  mq?.removeEventListener('change', syncDrawer)
  window.removeEventListener('admin-profile-updated', onProfileUpdated)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (unreadRefreshTimer !== undefined) window.clearInterval(unreadRefreshTimer)
  if (presenceHeartbeatTimer !== undefined) window.clearInterval(presenceHeartbeatTimer)
})

watch(() => route.path, () => {
  if (import.meta.client && !document.hidden) heartbeatAdminPresence()
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
              <md-list ref="desktopNavList" class="nav-list">
                <md-list-item
                  v-for="item in navItems"
                  :key="item.to"
                  type="link"
                  :href="item.to"
                  :class="{ 'nav-item--active': isActive(item.to) }"
                  @click="onNav($event, item.to)"
                >
                  <md-icon slot="start" :class="{ 'icon--active': isActive(item.to) }">{{ item.icon }}</md-icon>
                  <span slot="headline" class="nav-item-headline" :class="{ 'label--active': isActive(item.to) }">
                    {{ item.label }}
                    <span
                      v-if="itemHasUnread(item.key)"
                      class="unread-dot"
                      title="有未读域名邮件"
                      aria-label="有未读域名邮件"
                    ></span>
                  </span>
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
            <AppScrollbar :target="desktopNavList" label="侧边栏滚动条" />
          </md-navigation-drawer>

          <aside v-else key="collapsed" class="desktop-collapsed-nav">
            <nav ref="collapsedNavList" class="collapsed-nav-list" aria-label="主导航">
              <md-icon-button
                v-for="item in navItems"
                :key="item.to"
                :aria-label="item.label"
                :title="item.label"
                class="collapsed-nav-entry"
                :class="{ 'collapsed-nav-item--active': isActive(item.to) }"
                @click="onNav($event, item.to)"
              >
                <md-icon>{{ item.icon }}</md-icon>
                <span
                  v-if="itemHasUnread(item.key)"
                  class="unread-dot unread-dot--collapsed"
                  aria-hidden="true"
                ></span>
              </md-icon-button>
            </nav>
            <AppScrollbar :target="collapsedNavList" label="侧边栏滚动条" />
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
          <md-list ref="mobileNavList" class="nav-list">
            <md-list-item
              v-for="item in navItems"
              :key="item.to"
              type="link"
              :href="item.to"
              :class="{ 'nav-item--active': isActive(item.to) }"
              @click="onNav($event, item.to)"
            >
              <md-icon slot="start" :class="{ 'icon--active': isActive(item.to) }">{{ item.icon }}</md-icon>
              <span slot="headline" class="nav-item-headline" :class="{ 'label--active': isActive(item.to) }">
                {{ item.label }}
                <span
                  v-if="itemHasUnread(item.key)"
                  class="unread-dot"
                  title="有未读域名邮件"
                  aria-label="有未读域名邮件"
                ></span>
              </span>
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
        <AppScrollbar v-if="drawerOpen" :target="mobileNavList" label="侧边栏滚动条" />
      </md-navigation-drawer-modal>

      <main class="content">
        <div v-if="permissionNotice" class="permission-notice">
          <md-icon>{{ permissionNotice.icon }}</md-icon>
          <span>{{ permissionNotice.text }}</span>
        </div>
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
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
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
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
}

.collapsed-nav-list::-webkit-scrollbar,
.nav-list::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.collapsed-nav-item--active {
  color: var(--md-sys-color-primary);
  --md-icon-button-state-layer-color: var(--md-sys-color-primary);
}

.collapsed-nav-item--active md-icon {
  font-variation-settings: 'FILL' 1;
}

.collapsed-nav-entry {
  position: relative;
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

md-navigation-drawer-modal:not(.drawer-modal--open) {
  visibility: hidden;
}

.drawer-content {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.nav-list {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-top: 8px;
  scrollbar-width: none;
}

.logout-item {
  flex: 0 0 auto;
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

.nav-item-headline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.unread-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--md-sys-color-error);
  box-shadow: 0 0 0 2px var(--md-sys-color-surface-container);
}

.unread-dot--collapsed {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 7px;
  height: 7px;
  pointer-events: none;
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

.permission-notice {
  width: min(calc(100% - 32px), 1136px);
  margin: 16px auto 0;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 8px;
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface-container);
  font-size: 13px;
}

.permission-notice md-icon {
  flex: 0 0 auto;
  --md-icon-size: 20px;
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
    inset: 56px 0 0;
    --md-navigation-drawer-modal-container-width: min(320px, calc(100vw - 40px));
  }
}
</style>
