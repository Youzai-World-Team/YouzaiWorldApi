import { computed, onBeforeUnmount, onMounted, type Ref } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeViewTransition {
  ready: Promise<void>
  finished: Promise<void>
}

type ThemeTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ThemeViewTransition
}

const THEME_COLORS = {
  light: '#fbfef6',
  dark: '#101408',
} as const

let transitionRunning = false

function validThemeMode(value: string | null): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

export function updateBrowserThemeColor(isDark: boolean) {
  if (typeof document === 'undefined') return

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = isDark ? THEME_COLORS.dark : THEME_COLORS.light
}

export function useThemeTransition(dark: Ref<boolean>, mode: Ref<ThemeMode>) {
  let systemMedia: MediaQueryList | null = null

  function resolveDark(themeMode: ThemeMode): boolean {
    return themeMode === 'system'
      ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      : themeMode === 'dark'
  }

  function applyTheme(nextMode: ThemeMode, persist = true) {
    mode.value = nextMode
    dark.value = resolveDark(nextMode)
    if (typeof document === 'undefined') return
    document.documentElement.dataset.theme = dark.value ? 'dark' : 'light'
    document.documentElement.dataset.themeMode = nextMode
    updateBrowserThemeColor(dark.value)
    if (persist) localStorage.setItem('theme', nextMode)
  }

  function syncSystemTheme() {
    if (mode.value === 'system') applyTheme('system', false)
  }

  function getButtonCenter(button: HTMLElement | null) {
    const rect = button?.getBoundingClientRect()
    return {
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
    }
  }

  function getButtonFromEvent(event: MouseEvent): HTMLElement | null {
    if (event.currentTarget instanceof HTMLElement) return event.currentTarget
    return event.composedPath().find((node) =>
      node instanceof HTMLElement && node.tagName.toLowerCase() === 'md-icon-button') as HTMLElement | null
  }

  function getAnimationOrigin(event: MouseEvent) {
    const hasPointerCoordinates = event.detail > 0 || event.clientX !== 0 || event.clientY !== 0
    if (hasPointerCoordinates && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      return { x: event.clientX, y: event.clientY }
    }
    return getButtonCenter(getButtonFromEvent(event))
  }

  async function changeTheme(nextMode: ThemeMode, event: MouseEvent) {
    if (transitionRunning || typeof document === 'undefined') return
    if (nextMode === mode.value) return

    const transitionDocument = document as ThemeTransitionDocument
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!transitionDocument.startViewTransition || reduceMotion) {
      applyTheme(nextMode)
      return
    }

    const { x, y } = getAnimationOrigin(event)
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    transitionRunning = true
    document.documentElement.classList.add('theme-transition')
    try {
      const transition = transitionDocument.startViewTransition(() => applyTheme(nextMode))
      await transition.ready
      const reveal = document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 520,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
          pseudoElement: '::view-transition-new(root)',
        } as KeyframeAnimationOptions,
      )
      await Promise.allSettled([reveal.finished, transition.finished])
    } catch {
      if (mode.value !== nextMode) applyTheme(nextMode)
    } finally {
      document.documentElement.classList.remove('theme-transition')
      transitionRunning = false
    }
  }

  function toggleTheme(event: MouseEvent) {
    const nextMode: ThemeMode = mode.value === 'system'
      ? 'light'
      : mode.value === 'light'
        ? 'dark'
        : 'system'
    return changeTheme(nextMode, event)
  }

  const themeIcon = computed(() => mode.value === 'system' ? 'brightness_auto' : dark.value ? 'light_mode' : 'dark_mode')
  const themeModeLabel = computed(() => mode.value === 'system' ? '跟随系统配色' : dark.value ? '当前深色模式' : '当前浅色模式')
  const themeButtonLabel = computed(() => mode.value === 'system' ? '切换至浅色模式' : mode.value === 'light' ? '切换至深色模式' : '切换至跟随系统')

  onMounted(() => {
    applyTheme(validThemeMode(localStorage.getItem('theme')), false)
    systemMedia = window.matchMedia('(prefers-color-scheme: dark)')
    systemMedia.addEventListener('change', syncSystemTheme)
  })

  onBeforeUnmount(() => {
    systemMedia?.removeEventListener('change', syncSystemTheme)
  })

  return { applyTheme, toggleTheme, themeIcon, themeModeLabel, themeButtonLabel }
}
