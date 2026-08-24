import { computed, onBeforeUnmount, onMounted, type Ref } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_COLORS = {
  light: '#fbfef6',
  dark: '#101408',
} as const

const THEME_TRANSITION_DURATION = 360
type ThemeName = 'light' | 'dark'
type ThemePalette = Record<string, string>

const THEME_PALETTE: Record<ThemeName, ThemePalette> = {
  light: {
    '--md-sys-color-primary': '#8bc34a',
    '--md-sys-color-on-primary': '#1e3300',
    '--md-sys-color-primary-container': '#d9f2b0',
    '--md-sys-color-on-primary-container': '#1c3a00',
    '--md-sys-color-secondary-container': '#d9f2b0',
    '--md-sys-color-on-secondary-container': '#1c3a00',
    '--md-sys-color-surface': '#fbfef6',
    '--md-sys-color-surface-container': '#f0f7e6',
    '--md-sys-color-surface-container-high': '#eaf0dd',
    '--md-sys-color-on-surface': '#191d14',
    '--md-sys-color-on-surface-variant': '#44483b',
    '--md-sys-color-outline': '#737968',
    '--md-sys-color-outline-variant': '#c2c9b4',
    '--md-sys-color-inverse-surface': '#322f35',
    '--md-sys-color-inverse-on-surface': '#f5eff7',
    '--md-sys-color-error': '#b3261e',
    '--md-sys-color-on-error': '#ffffff',
    '--act-info': '#1a73e8',
    '--act-success': '#188038',
    '--act-warning': '#b06000',
    '--act-error': '#c5221f',
  },
  dark: {
    '--md-sys-color-primary': '#b7e08d',
    '--md-sys-color-on-primary': '#1d3500',
    '--md-sys-color-primary-container': '#3a5c00',
    '--md-sys-color-on-primary-container': '#d4f2a8',
    '--md-sys-color-secondary-container': '#3a5c00',
    '--md-sys-color-on-secondary-container': '#d4f2a8',
    '--md-sys-color-surface': '#101408',
    '--md-sys-color-surface-container': '#1a1f12',
    '--md-sys-color-surface-container-high': '#252a1c',
    '--md-sys-color-on-surface': '#e2e5d5',
    '--md-sys-color-on-surface-variant': '#c3c9b3',
    '--md-sys-color-outline': '#8d927e',
    '--md-sys-color-outline-variant': '#42493a',
    '--md-sys-color-inverse-surface': '#e6e0e9',
    '--md-sys-color-inverse-on-surface': '#322f35',
    '--md-sys-color-error': '#f2b8b5',
    '--md-sys-color-on-error': '#601410',
    '--act-info': '#8ab4f8',
    '--act-success': '#81c995',
    '--act-warning': '#fdd663',
    '--act-error': '#f28b82',
  },
}

const THEME_VARIABLES = Object.keys(THEME_PALETTE.light)

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

  function animateFallbackTheme(nextMode: ThemeMode, root: HTMLElement, fromName: ThemeName) {
    const toName: ThemeName = resolveDark(nextMode) ? 'dark' : 'light'
    const fromPalette = THEME_PALETTE[fromName]
    const toPalette = THEME_PALETTE[toName]

    // Keep the old colors as inline values while the data attribute switches;
    // then interpolate every theme token explicitly. This works on mobile
    // browsers even when CSS custom-property transitions are unsupported.
    for (const variable of THEME_VARIABLES) root.style.setProperty(variable, fromPalette[variable]!)
    applyTheme(nextMode)

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
    const fromName: ThemeName = dark.value ? 'dark' : 'light'
    transitionRunning = true
    try {
      if (reduceMotion) {
        applyTheme(nextMode)
      } else {
        root.classList.add('theme-transition-colors')
        await animateFallbackTheme(nextMode, root, fromName)
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
