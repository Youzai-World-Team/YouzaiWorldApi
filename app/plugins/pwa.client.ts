export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return

  async function registerServiceWorker() {
    try {
      await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
    } catch (error) {
      console.warn('Service Worker registration failed:', error)
    }
  }

  if (document.readyState === 'complete') {
    void registerServiceWorker()
  } else {
    window.addEventListener('load', registerServiceWorker, { once: true })
  }
})
