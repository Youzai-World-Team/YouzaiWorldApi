<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const route = useRoute()

const navItems = [
  { label: '仪表盘', icon: 'dashboard', to: '/' }
]

const drawerOpen = ref(true)
const dark = ref(false)

const mq = typeof window !== 'undefined' ? window.matchMedia('(min-width: 900px)') : null

function syncDrawer() {
  drawerOpen.value = mq ? mq.matches : true
}

function applyTheme(isDark: boolean) {
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
  localStorage.setItem('theme', isDark ? 'dark' : 'light')
}

function toggleTheme() {
  dark.value = !dark.value
  applyTheme(dark.value)
}

function onNav(e: Event) {
  e.preventDefault()
  const href = (e.currentTarget as HTMLElement).getAttribute('href')
  if (href) navigateTo(href)
}

onMounted(() => {
  syncDrawer()
  mq?.addEventListener('change', syncDrawer)
  const saved = localStorage.getItem('theme')
  dark.value = saved === 'dark'
  applyTheme(dark.value)
})

onBeforeUnmount(() => {
  mq?.removeEventListener('change', syncDrawer)
})
</script>

<template>
  <div class="shell">
    <header class="app-bar">
      <md-icon-button aria-label="菜单" @click="drawerOpen = !drawerOpen">
        <md-icon>menu</md-icon>
      </md-icon-button>
      <span class="app-bar-title">YouzaiWorld 管理后台</span>
      <div class="app-bar-actions">
        <md-icon-button :aria-label="dark ? '切换浅色' : '切换深色'" @click="toggleTheme">
          <md-icon>{{ dark ? 'light_mode' : 'dark_mode' }}</md-icon>
        </md-icon-button>
      </div>
    </header>

    <div class="body">
      <md-navigation-drawer :opened="drawerOpen" pivot="start">
        <md-list class="nav-list">
          <md-list-item
            v-for="item in navItems"
            :key="item.to"
            type="link"
            :href="item.to"
            :selected="route.path === item.to"
            @click="onNav"
          >
            <md-icon slot="start">{{ item.icon }}</md-icon>
            <span slot="headline">{{ item.label }}</span>
          </md-list-item>
        </md-list>
      </md-navigation-drawer>

      <main class="content">
        <NuxtPage />
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
}

.app-bar-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
}

.app-bar-actions {
  margin-left: auto;
}

.body {
  display: flex;
  min-height: 100vh;
  padding-top: 64px;
}

md-navigation-drawer {
  --md-navigation-drawer-container-width: 256px;
  --md-navigation-drawer-container-color: var(--md-sys-color-surface-container);
  --md-navigation-drawer-divider-color: transparent;
  flex-shrink: 0;
}

.nav-list {
  padding-top: 8px;
}

md-list {
  --md-list-container-color: transparent;
}

.content {
  flex: 1;
  min-width: 0;
  background: var(--md-sys-color-surface);
}
</style>
