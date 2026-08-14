export function useDialogAnimation() {
  function openAnimation() {
    return {
      dialog: [
        [
          [
            { transform: 'scale(0.9)', opacity: '0' },
            { transform: 'scale(1)', opacity: '1' },
          ],
          { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        ],
      ],
      scrim: [
        [
          [{ opacity: 0 }, { opacity: 0.32 }],
          { duration: 200, easing: 'linear' },
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
          { duration: 150, easing: 'cubic-bezier(0.4, 0, 1, 1)' },
        ],
      ],
      scrim: [
        [
          [{ opacity: 0.32 }, { opacity: 0 }],
          { duration: 150, easing: 'linear' },
        ],
      ],
    }
  }

  function apply(el: HTMLElement | null) {
    if (!el) return
    const dialog = el as any
    dialog.getOpenAnimation = openAnimation
    dialog.getCloseAnimation = closeAnimation
  }

  return { apply }
}
