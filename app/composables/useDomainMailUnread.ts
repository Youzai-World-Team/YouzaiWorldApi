let unreadLoadPromise: Promise<number> | null = null

export function useDomainMailUnread() {
  const count = useState<number | null>('domain-mail-unread-count', () => null)

  async function load(force = false): Promise<number> {
    if (count.value !== null && !force) return count.value
    if (!unreadLoadPromise) {
      unreadLoadPromise = $fetch<{ count: number }>('/api/admin/domain-mails/unread-count')
        .then((result) => {
          count.value = Math.max(0, Number(result.count) || 0)
          return count.value
        })
        .finally(() => {
          unreadLoadPromise = null
        })
    }
    return unreadLoadPromise
  }

  function setCount(value: number) {
    count.value = Math.max(0, Math.floor(Number(value) || 0))
  }

  function markRead(wasUnread: boolean) {
    if (!wasUnread || count.value === null) return
    count.value = Math.max(0, count.value - 1)
  }

  function clear() {
    count.value = null
    unreadLoadPromise = null
  }

  return { count, load, setCount, markRead, clear }
}
