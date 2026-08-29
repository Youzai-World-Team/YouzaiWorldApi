import { computed, onBeforeUnmount, onMounted, type Ref } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_COLORS = {
  light: '#fbfef6',
  dark: '#101408',
} as const

const THEME_TRANSITION_DURATION = 360
type ThemePalette = Record<string, string>

const THEME_VARIABLES = [
  '--md-sys-color-primary',
  '--md-sys-color-on-primary',
  '--md-sys-color-primary-container',
  '--md-sys-color-on-primary-container',
  '--md-sys-color-primary-fixed',
  '--md-sys-color-primary-fixed-dim',
  '--md-sys-color-on-primary-fixed',
  '--md-sys-color-on-primary-fixed-variant',
  '--md-sys-color-secondary',
  '--md-sys-color-on-secondary',
  '--md-sys-color-secondary-container',
  '--md-sys-color-on-secondary-container',
  '--md-sys-color-secondary-fixed',
  '--md-sys-color-secondary-fixed-dim',
  '--md-sys-color-on-secondary-fixed',
  '--md-sys-color-on-secondary-fixed-variant',
  '--md-sys-color-tertiary',
  '--md-sys-color-on-tertiary',
  '--md-sys-color-tertiary-container',
  '--md-sys-color-on-tertiary-container',
  '--md-sys-color-tertiary-fixed',
  '--md-sys-color-tertiary-fixed-dim',
  '--md-sys-color-on-tertiary-fixed',
  '--md-sys-color-on-tertiary-fixed-variant',
  '--md-sys-color-background',
  '--md-sys-color-on-background',
  '--md-sys-color-surface',
  '--md-sys-color-surface-dim',
  '--md-sys-color-surface-bright',
  '--md-sys-color-surface-container-lowest',
  '--md-sys-color-surface-container-low',
  '--md-sys-color-surface-container',
  '--md-sys-color-surface-container-high',
  '--md-sys-color-surface-container-highest',
  '--md-sys-color-surface-variant',
  '--md-sys-color-on-surface',
  '--md-sys-color-on-surface-variant',
  '--md-sys-color-outline',
  '--md-sys-color-outline-variant',
  '--md-sys-color-surface-tint',
  '--md-sys-color-inverse-surface',
  '--md-sys-color-inverse-on-surface',
  '--md-sys-color-inverse-primary',
  '--md-sys-color-error',
  '--md-sys-color-on-error',
  '--md-sys-color-error-container',
  '--md-sys-color-on-error-container',
  '--md-sys-color-shadow',
  '--md-sys-color-scrim',
  '--act-info',
  '--act-success',
  '--act-warning',
  '--act-error',
] as const

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

  function interpolateColor(from: string, to: string, progress: number) {
    const parse = (color: string) => [0, 2, 4].map((offset) => Number.parseInt(color.slice(offset + 1, offset + 3), 16))
    const fromRgb = parse(from)
    const toRgb = parse(to)
    return `rgb(${fromRgb.map((channel, index) => Math.round(channel + (toRgb[index] - channel) * progress)).join(' ')})`
  }

  function readThemePalette(root: HTMLElement): ThemePalette {
    const styles = window.getComputedStyle(root)
    return Object.fromEntries(THEME_VARIABLES.map((variable) => [variable, styles.getPropertyValue(variable).trim()]))
  }

  function animateFallbackTheme(nextMode: ThemeMode, root: HTMLElement) {
    const fromPalette = readThemePalette(root)
    applyTheme(nextMode)
    const toPalette = readThemePalette(root)

    for (const variable of THEME_VARIABLES) root.style.setProperty(variable, fromPalette[variable]!)

    return new Promise<void>((resolve) => {
      const startedAt = performance.now()
      const animate = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / THEME_TRANSITION_DURATION)
        const eased = 1 - (1 - progress) ** 3
        for (const variable of THEME_VARIABLES) {
          root.style.setProperty(variable, interpolateColor(fromPalette[variable]!, toPalette[variable]!, eased))
        }
        if (progress < 1) {
          window.requestAnimationFrame(animate)
          return
        }
        for (const variable of THEME_VARIABLES) root.style.removeProperty(variable)
        resolve()
      }
      window.requestAnimationFrame(animate)
    })
  }

  async function changeTheme(nextMode: ThemeMode) {
    if (transitionRunning || typeof document === 'undefined') return
    if (nextMode === mode.value) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const root = document.documentElement
    transitionRunning = true
    try {
      if (reduceMotion) {
        applyTheme(nextMode)
      } else {
        root.classList.add('theme-transition-colors')
        await animateFallbackTheme(nextMode, root)
      }
    } catch {
      // Always leave the document in the requested theme if animation fails.
      if (mode.value !== nextMode || dark.value !== resolveDark(nextMode)) applyTheme(nextMode)
    } finally {
      root.classList.remove('theme-transition-colors')
      for (const variable of THEME_VARIABLES) root.style.removeProperty(variable)
      transitionRunning = false
    }
  }

  function toggleTheme() {
    const nextMode: ThemeMode = mode.value === 'system'
      ? 'light'
      : mode.value === 'light'
        ? 'dark'
        : 'system'
    return changeTheme(nextMode)
  }

  // The icon describes the mode currently in use; the accessible label/title
  // continues to describe the mode that will be selected on the next click.
  const themeIcon = computed(() => mode.value === 'system'
    ? 'brightness_auto'
    : mode.value === 'dark'
      ? 'dark_mode'
      : 'light_mode')
  const themeModeLabel = computed(() => mode.value === 'system' ? '跟随系统配色' : dark.value ? '当前深色模式' : '当前浅色模式')
  const themeButtonLabel = computed(() => mode.value === 'system'
    ? '切换至浅色模式'
    : mode.value === 'light'
      ? '切换至深色模式'
      : '切换至跟随系统')

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
