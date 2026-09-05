const DIALOG_ANIMATION_PATCHED = Symbol.for('youzaiworld.dialog-animation-patched')
const DIALOG_BACKDROP_STYLE = 'youzaiworld-dialog-backdrop'
const dialogScrollbarControllers = new WeakMap<HTMLElement, DialogScrollbarController>()
const dialogScrollbarInstallPromises = new WeakMap<HTMLElement, Promise<unknown>>()

interface AnimatedDialogElement extends HTMLElement {
  getOpenAnimation: typeof openAnimation
  getCloseAnimation: typeof closeAnimation
}

interface AnimatedDialogPrototype extends AnimatedDialogElement {
  connectedCallback?: () => void
  disconnectedCallback?: () => void
  [key: symbol]: unknown
}

type DialogElementWithUpdateComplete = HTMLElement & { updateComplete?: Promise<unknown> }

class DialogScrollbarController {
  private readonly host: HTMLElement
  private readonly ownerDocument: Document
  private readonly ownerWindow: Window | null
  readonly scroller: HTMLElement
  private readonly container: HTMLElement
  private readonly shadowRoot: ShadowRoot
  private readonly track: HTMLDivElement
  private readonly thumb: HTMLSpanElement
  private resizeObserver: ResizeObserver | null = null
  private mutationObserver: MutationObserver | null = null
  private updateFrame = 0
  private hideTimer: number | undefined
  private thumbHeight = 0
  private thumbTop = 0
  private scrollTop = 0
  private maxScroll = 0
  private isScrollable = false
  private isDragging = false
  private dragPointerId: number | null = null
  private dragStartY = 0
  private dragStartScrollTop = 0

  get isAttached() {
    return this.track.isConnected
  }

  constructor(el: HTMLElement, scroller: HTMLElement) {
    this.host = el
    this.ownerDocument = el.ownerDocument
    this.ownerWindow = this.ownerDocument.defaultView
    this.scroller = scroller
    this.container = scroller.parentElement ?? scroller
    this.shadowRoot = el.shadowRoot as ShadowRoot
    this.track = this.ownerDocument.createElement('div')
    this.track.className = 'yzw-dialog-scrollbar'
    this.track.setAttribute('role', 'scrollbar')
    this.track.setAttribute('aria-label', '弹窗滚动条')
    this.track.setAttribute('aria-orientation', 'vertical')
    this.track.setAttribute('aria-hidden', 'true')
    this.track.tabIndex = -1
    this.thumb = this.ownerDocument.createElement('span')
    this.thumb.className = 'yzw-dialog-scrollbar__thumb'
    this.track.append(this.thumb)
    this.container.append(this.track)

    this.track.addEventListener('pointerdown', this.onTrackPointerDown)
    this.thumb.addEventListener('pointerdown', this.onThumbPointerDown)
    this.track.addEventListener('keydown', this.onKeydown)
    this.scroller.addEventListener('scroll', this.onScroll, { passive: true })
    this.ownerWindow?.addEventListener('pointermove', this.onPointerMove, { passive: true })
    this.ownerWindow?.addEventListener('pointerup', this.onPointerUp, { passive: true })
    this.ownerWindow?.addEventListener('pointercancel', this.onPointerUp, { passive: true })

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.scheduleUpdate)
      this.resizeObserver.observe(this.scroller)
      this.resizeObserver.observe(this.container)
      const content = this.scroller.querySelector<HTMLElement>('.content')
      if (content) this.resizeObserver.observe(content)
    }
    if (typeof MutationObserver !== 'undefined') {
      this.mutationObserver = new MutationObserver(() => {
        if (!this.track.isConnected) {
          disposeDialogScrollbar(this.host)
          installDialogScrollbar(this.host)
          return
        }
        this.scheduleUpdate()
      })
      this.mutationObserver.observe(this.scroller, { childList: true, subtree: true, characterData: true })
      this.mutationObserver.observe(this.host, { childList: true, subtree: true, characterData: true })
      this.mutationObserver.observe(this.shadowRoot, { childList: true, subtree: true })
    }
    this.scheduleUpdate()
  }

  update = () => {
    this.updateFrame = 0
    const containerRect = this.container.getBoundingClientRect()
    const scrollerRect = this.scroller.getBoundingClientRect()
    const trackTop = Math.max(0, scrollerRect.top - containerRect.top + 8)
    const trackHeight = Math.max(0, scrollerRect.height - 16)
    this.track.style.top = `${trackTop}px`
    this.track.style.height = `${trackHeight}px`
    this.track.style.bottom = 'auto'
    const viewportHeight = this.scroller.clientHeight
    const scrollHeight = this.scroller.scrollHeight
    const maxScroll = Math.max(0, scrollHeight - viewportHeight)
    this.maxScroll = maxScroll
    this.scrollTop = Math.min(Math.max(0, this.scroller.scrollTop), maxScroll)
    this.isScrollable = maxScroll > 1 && trackHeight > 0
    this.track.classList.toggle('yzw-dialog-scrollbar--available', this.isScrollable)
    this.track.tabIndex = this.isScrollable ? 0 : -1
    this.track.setAttribute('aria-hidden', this.isScrollable ? 'false' : 'true')
    this.track.setAttribute('aria-valuemin', '0')
    this.track.setAttribute('aria-valuemax', `${Math.round(maxScroll)}`)
    this.track.setAttribute('aria-valuenow', `${Math.round(this.scrollTop)}`)

    if (!this.isScrollable) {
      this.isDragging = false
      this.dragPointerId = null
      this.thumbHeight = 0
      this.thumbTop = 0
      this.track.classList.remove('yzw-dialog-scrollbar--visible', 'yzw-dialog-scrollbar--dragging')
      this.thumb.style.height = '0px'
      this.thumb.style.transform = 'translateY(0px)'
      return
    }

    this.thumbHeight = Math.min(trackHeight, Math.max(36, (viewportHeight / scrollHeight) * trackHeight))
    const travel = Math.max(0, trackHeight - this.thumbHeight)
    this.thumbTop = maxScroll > 0 ? (this.scrollTop / maxScroll) * travel : 0
    this.thumb.style.height = `${this.thumbHeight}px`
    this.thumb.style.transform = `translateY(${this.thumbTop}px)`
  }

  scheduleUpdate = () => {
    if (this.updateFrame || !this.ownerWindow) return
    this.updateFrame = this.ownerWindow.requestAnimationFrame(this.update)
  }

  show = () => {
    if (!this.isScrollable) return
    this.track.classList.add('yzw-dialog-scrollbar--visible')
    if (this.hideTimer !== undefined && this.ownerWindow) this.ownerWindow.clearTimeout(this.hideTimer)
    if (!this.isDragging && this.ownerWindow) {
      this.hideTimer = this.ownerWindow.setTimeout(() => {
        this.track.classList.remove('yzw-dialog-scrollbar--visible')
      }, 900)
    }
  }

  onScroll = () => {
    this.scheduleUpdate()
    this.show()
  }

  scrollTo = (top: number) => {
    this.scroller.scrollTop = Math.min(this.maxScroll, Math.max(0, top))
    this.scheduleUpdate()
  }

  scrollToTrackPosition = (clientY: number) => {
    if (!this.isScrollable) return
    const rect = this.track.getBoundingClientRect()
    const travel = Math.max(1, rect.height - this.thumbHeight)
    const position = Math.min(travel, Math.max(0, clientY - rect.top - this.thumbHeight / 2))
    this.scrollTo((position / travel) * this.maxScroll)
    this.show()
  }

  onTrackPointerDown = (event: PointerEvent) => {
    if (event.target === event.currentTarget) this.scrollToTrackPosition(event.clientY)
  }

  onThumbPointerDown = (event: PointerEvent) => {
    if (!this.isScrollable) return
    this.isDragging = true
    this.dragPointerId = event.pointerId
    this.dragStartY = event.clientY
    this.dragStartScrollTop = this.scrollTop
    this.track.classList.add('yzw-dialog-scrollbar--visible', 'yzw-dialog-scrollbar--dragging')
    this.track.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  onPointerMove = (event: PointerEvent) => {
    if (!this.isDragging || !this.isScrollable || event.pointerId !== this.dragPointerId) return
    const travel = Math.max(1, this.track.clientHeight - this.thumbHeight)
    const delta = event.clientY - this.dragStartY
    this.scrollTo(this.dragStartScrollTop + (delta / travel) * this.maxScroll)
  }

  onPointerUp = (event: PointerEvent) => {
    if (!this.isDragging || event.pointerId !== this.dragPointerId) return
    this.isDragging = false
    this.dragPointerId = null
    this.track.classList.remove('yzw-dialog-scrollbar--dragging')
    this.show()
  }

  onKeydown = (event: KeyboardEvent) => {
    if (!this.isScrollable) return
    const pageStep = Math.max(48, this.scroller.clientHeight * 0.9)
    let next: number | null = null
    if (event.key === 'ArrowDown') next = this.scrollTop + 48
    if (event.key === 'ArrowUp') next = this.scrollTop - 48
    if (event.key === 'PageDown') next = this.scrollTop + pageStep
    if (event.key === 'PageUp') next = this.scrollTop - pageStep
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = this.maxScroll
    if (next === null) return
    event.preventDefault()
    this.scrollTo(next)
    this.show()
  }

  dispose() {
    if (this.updateFrame && this.ownerWindow) this.ownerWindow.cancelAnimationFrame(this.updateFrame)
    if (this.hideTimer !== undefined && this.ownerWindow) this.ownerWindow.clearTimeout(this.hideTimer)
    this.resizeObserver?.disconnect()
    this.mutationObserver?.disconnect()
    this.track.removeEventListener('pointerdown', this.onTrackPointerDown)
    this.thumb.removeEventListener('pointerdown', this.onThumbPointerDown)
    this.track.removeEventListener('keydown', this.onKeydown)
    this.scroller.removeEventListener('scroll', this.onScroll)
    this.ownerWindow?.removeEventListener('pointermove', this.onPointerMove)
    this.ownerWindow?.removeEventListener('pointerup', this.onPointerUp)
    this.ownerWindow?.removeEventListener('pointercancel', this.onPointerUp)
    this.track.remove()
  }
}

function disposeDialogScrollbar(el: HTMLElement) {
  const controller = dialogScrollbarControllers.get(el)
  if (!controller) return
  controller.dispose()
  dialogScrollbarControllers.delete(el)
}

function installDialogScrollbar(el: HTMLElement) {
  const root = el.shadowRoot
  if (!root) return
  const scroller = root.querySelector<HTMLElement>('.scroller')
  if (!scroller) {
    const updateComplete = (el as DialogElementWithUpdateComplete).updateComplete
    if (updateComplete && !dialogScrollbarInstallPromises.has(el)) {
      const retry = updateComplete.then(() => {
        dialogScrollbarInstallPromises.delete(el)
        if (el.isConnected) installDialogScrollbar(el)
      }).catch(() => {
        dialogScrollbarInstallPromises.delete(el)
      })
      dialogScrollbarInstallPromises.set(el, retry)
    }
    return
  }

  const current = dialogScrollbarControllers.get(el)
  if (current && current.scroller === scroller && current.isAttached) {
    current.scheduleUpdate()
    return
  }
  disposeDialogScrollbar(el)
  dialogScrollbarControllers.set(el, new DialogScrollbarController(el, scroller))
}

function installNativeBackdrop(el: HTMLElement) {
  const root = el.shadowRoot
  if (!root) return

  const style = root.querySelector<HTMLStyleElement>(`style[data-patch='${DIALOG_BACKDROP_STYLE}']`)
    ?? el.ownerDocument.createElement('style')
  style.dataset.patch = DIALOG_BACKDROP_STYLE
  style.textContent = `
    :host([open]) .scrim { display: none !important; }
    /* 使用原生 backdrop，避免 Material Web 的内部 scrim 影响 top-layer 层级。 */
    dialog::backdrop {
      background: var(--md-sys-color-scrim, #000000);
      opacity: 0.32;
    }

    /* md-dialog 的滚动容器位于 Shadow DOM 内，页面全局滚动条规则无法穿透。 */
    .scroller {
      position: relative;
      overflow-y: auto !important;
      scrollbar-width: none !important;
      -ms-overflow-style: none;
    }
    .scroller::-webkit-scrollbar {
      width: 0;
      height: 0;
      display: none;
    }
    .yzw-dialog-scrollbar {
      position: absolute;
      z-index: 2;
      top: 8px;
      right: 4px;
      bottom: auto;
      width: 12px;
      height: calc(100% - 16px);
      padding: 0 3px;
      box-sizing: border-box;
      border-radius: 999px;
      opacity: 0;
      outline: none;
      pointer-events: none;
      transition: opacity var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard);
    }
    .yzw-dialog-scrollbar--available {
      opacity: 0.45;
      pointer-events: auto;
    }
    .yzw-dialog-scrollbar--visible,
    .yzw-dialog-scrollbar:focus-visible,
    .yzw-dialog-scrollbar--dragging {
      opacity: 1;
      pointer-events: auto;
    }
    .yzw-dialog-scrollbar__thumb {
      display: block;
      width: 6px;
      min-height: 36px;
      box-sizing: border-box;
      border: 1px solid color-mix(in srgb, var(--md-sys-color-on-surface) 18%, transparent);
      border-radius: 999px;
      background: var(--app-scrollbar-thumb-hover);
      box-shadow: var(--md-sys-elevation-level1);
      cursor: grab;
      touch-action: none;
      transition:
        width var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard),
        background-color var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard),
        box-shadow var(--md-sys-motion-duration-short3) var(--md-sys-motion-easing-standard);
    }
    .yzw-dialog-scrollbar:hover .yzw-dialog-scrollbar__thumb,
    .yzw-dialog-scrollbar:focus-visible .yzw-dialog-scrollbar__thumb,
    .yzw-dialog-scrollbar--dragging .yzw-dialog-scrollbar__thumb {
      width: 8px;
      margin-left: -1px;
      background: var(--app-scrollbar-thumb-active);
      box-shadow: var(--md-sys-elevation-level2);
    }
    .yzw-dialog-scrollbar--dragging .yzw-dialog-scrollbar__thumb { cursor: grabbing; }
    :host([data-yzw-source-fullscreen]) .yzw-dialog-scrollbar { display: none !important; }
  `
  if (!style.isConnected) root.append(style)
  installDialogScrollbar(el)
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
      [
        [{ opacity: 0 }, { opacity: 0.32 }],
        {
          duration: duration(200),
          easing: 'linear',
          pseudoElement: '::backdrop',
        },
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
      [
        [{ opacity: 0.32 }, { opacity: 0 }],
        {
          duration: duration(150),
          easing: 'linear',
          pseudoElement: '::backdrop',
        },
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
      const disconnectedCallback = prototype.disconnectedCallback
      prototype.disconnectedCallback = function (this: HTMLElement) {
        disposeDialogScrollbar(this)
        disconnectedCallback?.call(this)
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
