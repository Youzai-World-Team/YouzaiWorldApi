<script setup lang="ts">
const bootOverlay = ref<HTMLElement | null>(null)

// 在首次渲染前（<head> 内联脚本）就根据本地存储还原深浅色主题，避免初始闪亮/闪暗
const themeBootScript = `(function(){try{var t=localStorage.getItem('theme');document.documentElement.dataset.theme=t==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}})()`

useHead({
  script: [
    {
      innerHTML: themeBootScript,
    },
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
