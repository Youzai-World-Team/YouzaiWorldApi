const DIALOG_ANIMATION_PATCHED = Symbol.for('youzaiworld.dialog-animation-patched')
const DIALOG_BACKDROP_STYLE = 'youzaiworld-dialog-backdrop'

interface AnimatedDialogElement extends HTMLElement {
  getOpenAnimation: typeof openAnimation
  getCloseAnimation: typeof closeAnimation
}

interface AnimatedDialogPrototype extends AnimatedDialogElement {
  connectedCallback?: () => void
  [key: symbol]: unknown
}

function installNativeBackdrop(el: HTMLElement) {
  const root = el.shadowRoot
  if (!root || root.querySelector(`style[data-patch='${DIALOG_BACKDROP_STYLE}']`)) return

  const style = document.createElement('style')
  style.dataset.patch = DIALOG_BACKDROP_STYLE
  style.textContent = `
    :host([open]) .scrim { display: none !important; }
    dialog::backdrop { background: rgb(0 0 0 / 32%); }
  `
  root.append(style)
}

function duration(value: number) {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 1
    : value
}

function openAnimation() {
  return {
    dialog: [
      [
        [
          { transform: 'scale(0.9)', opacity: '0' },
          { transform: 'scale(1)', opacity: '1' },
        ],
        { duration: duration(200), easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      ],
    ],
    scrim: [
      [
        [{ opacity: 0 }, { opacity: 0.32 }],
        { duration: duration(200), easing: 'linear' },
      ],
    ],
  }
}

function closeAnimation() {
  return {
    dialog: [
      [
        [
          { transform: 'scale(1)', opacity: '1' },
          { transform: 'scale(0.9)', opacity: '0' },
        ],
        { duration: duration(150), easing: 'cubic-bezier(0.4, 0, 1, 1)' },
      ],
    ],
    scrim: [
      [
        [{ opacity: 0.32 }, { opacity: 0 }],
        { duration: duration(150), easing: 'linear' },
      ],
    ],
  }
}

export function applyDialogAnimation(el: HTMLElement | null) {
  if (!el) return
  const dialog = el as AnimatedDialogElement
  dialog.getOpenAnimation = openAnimation
  dialog.getCloseAnimation = closeAnimation
  installNativeBackdrop(el)
}

export function installDialogAnimation() {
  if (typeof customElements === 'undefined' || typeof document === 'undefined') return

  const install = () => {
    const constructor = customElements.get('md-dialog')
    if (!constructor) return

    const prototype = constructor.prototype as AnimatedDialogPrototype
    if (!prototype[DIALOG_ANIMATION_PATCHED]) {
      const connectedCallback = prototype.connectedCallback
      prototype.connectedCallback = function (this: HTMLElement) {
        connectedCallback?.call(this)
        applyDialogAnimation(this)
      }
      Object.defineProperty(prototype, DIALOG_ANIMATION_PATCHED, { value: true })
    }

    document.querySelectorAll<HTMLElement>('md-dialog').forEach(applyDialogAnimation)
  }

  if (customElements.get('md-dialog')) install()
  else void customElements.whenDefined('md-dialog').then(install)
}

export function useDialogAnimation() {
  return { apply: applyDialogAnimation }
}
