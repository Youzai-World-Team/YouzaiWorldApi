<script setup lang="ts">
const bootOverlay = ref<HTMLElement | null>(null)

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
  // 等待首屏完成渲染后再开始淡出遮罩
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      bootOverlay.value?.classList.add('boot-overlay--fade')
      setTimeout(() => bootOverlay.value?.remove(), 500)
    }),
  )
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
    <div ref="bootOverlay" class="boot-overlay" aria-hidden="true"></div>
  </div>
</template>

<style scoped>
.boot-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: #fbfef6;
  background: var(--md-sys-color-surface);
  opacity: 1;
  transition: opacity 0.45s ease;
}

.boot-overlay--fade {
  opacity: 0;
  pointer-events: none;
}
</style>
