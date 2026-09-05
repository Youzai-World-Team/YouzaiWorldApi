<script setup lang="ts">
import { WEB_ASSET_BASE_URL } from '#shared/web-assets'

const bootOverlay = ref<HTMLElement | null>(null)
const bootStartedAt = import.meta.client ? Date.now() : 0
const BOOT_MIN_DURATION = 450

// 在首次渲染前恢复主题；没有手动偏好时跟随浏览器声明的配色方案。
const themeBootScript = `(function(){try{var t=localStorage.getItem('theme');var s=t==='system'||(t!=='light'&&t!=='dark');var d=t==='dark'||(s&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.dataset.themeMode=s?'system':t;var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement('meta');m.name='theme-color';document.head.appendChild(m)}m.content=d?'#101408':'#fbfef6'}catch(e){document.documentElement.dataset.theme='light';document.documentElement.dataset.themeMode='system'}})()`

useHead({
  script: [
    {
      innerHTML: themeBootScript,
    },
  ],
  meta: [
    { name: 'theme-color', content: '#fbfef6' },
    { name: 'color-scheme', content: 'light dark' },
  ],
})

onNuxtReady(() => {
  // 参考官网保留最短展示时间，避免首屏加载动画只闪现一帧。
  const elapsed = Date.now() - bootStartedAt
  const reveal = () => requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      bootOverlay.value?.classList.add('boot-overlay--fade')
      window.setTimeout(() => bootOverlay.value?.remove(), 500)
    }),
  )
  window.setTimeout(reveal, Math.max(0, BOOT_MIN_DURATION - elapsed))
})
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <AppLoadingBar />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <AppToast />
    <AppScrollbar page label="页面滚动条" />
    <div ref="bootOverlay" class="boot-overlay" role="status" aria-label="正在加载页面">
      <div class="boot-loader-mark">
        <img :src="`${WEB_ASSET_BASE_URL}/images/uzw-tm.png`" alt="悠哉世界" />
        <span class="boot-loader-spinner" aria-hidden="true"></span>
        <span class="boot-loader-label">正在加载悠哉世界 API 后台</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.boot-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 9999;
  background: #fbfef6;
  background: var(--md-sys-color-surface);
  opacity: 1;
  transition: opacity 0.45s ease;
}

.boot-loader-mark {
  display: grid;
  place-items: center;
  gap: 16px;
  min-width: min(240px, calc(100vw - 32px));
  padding: 24px;
  box-sizing: border-box;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
}

.boot-loader-mark img {
  width: min(200px, calc(100vw - 64px));
  height: auto;
  display: block;
  animation: boot-loader-pulse 1.5s ease-in-out infinite;
}

.boot-loader-spinner {
  width: 24px;
  height: 24px;
  box-sizing: border-box;
  border: 3px solid color-mix(in srgb, var(--md-sys-color-primary) 24%, transparent);
  border-top-color: var(--md-sys-color-primary);
  border-radius: 50%;
  animation: boot-loader-spin 800ms linear infinite;
}

.boot-loader-label {
  line-height: 1.4;
}

@keyframes boot-loader-pulse {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.96);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes boot-loader-spin {
  to {
    transform: rotate(360deg);
  }
}

.boot-overlay--fade {
  opacity: 0;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .boot-loader-mark img,
  .boot-loader-spinner {
    animation: none;
  }

  .boot-overlay {
    transition-duration: 1ms;
  }
}
</style>
