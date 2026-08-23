const DIALOG_ANIMATION_PATCHED = Symbol.for('youzaiworld.dialog-animation-patched')

interface AnimatedDialogElement extends HTMLElement {
  getOpenAnimation: typeof openAnimation
  getCloseAnimation: typeof closeAnimation
}

interface AnimatedDialogPrototype extends AnimatedDialogElement {
  connectedCallback?: () => void
  [key: symbol]: unknown
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
}

export function installDialogAnimation() {
  if (typeof customElements === 'undefined' || typeof document === 'undefined') return

  const constructor = customElements.get('md-dialog')
  if (!constructor) return

  const prototype = constructor.prototype as AnimatedDialogPrototype
  if (!prototype[DIALOG_ANIMATION_PATCHED]) {
    const connectedCallback = prototype.connectedCallback
    prototype.connectedCallback = function (this: HTMLElement) {
      applyDialogAnimation(this)
      connectedCallback?.call(this)
    }
    Object.defineProperty(prototype, DIALOG_ANIMATION_PATCHED, { value: true })
  }

  document.querySelectorAll<HTMLElement>('md-dialog').forEach(applyDialogAnimation)
}

export function useDialogAnimation() {
  return { apply: applyDialogAnimation }
}
