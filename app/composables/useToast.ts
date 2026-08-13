export interface ToastItem {
  id: number
  message: string
  type: 'info' | 'error'
}

let seed = 0

export function useToast() {
  const toasts = useState<ToastItem[]>('toasts', () => [])

  function showToast(message: string, type: 'info' | 'error' = 'info', duration = 3000) {
    const id = ++seed
    toasts.value.push({ id, message, type })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, duration)
  }

  return { showToast, toasts }
}
