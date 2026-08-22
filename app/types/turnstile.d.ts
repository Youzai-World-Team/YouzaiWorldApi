interface TurnstileWidgetOptions {
  sitekey: string
  action?: string
  size?: 'normal' | 'compact' | 'flexible'
  callback?: (token: string) => void
  'error-callback'?: () => void
  'expired-callback'?: () => void
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileWidgetOptions) => string | number
  reset: (widgetId?: string | number) => void
  remove?: (widgetId?: string | number) => void
}

interface Window {
  turnstile?: TurnstileApi
}
