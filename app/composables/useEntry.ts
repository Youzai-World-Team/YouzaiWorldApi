export function useEntry() {
  const entry = useState<string>('security-entry', () => '')
  const requestFetch = useRequestFetch()

  const remember = (value: string) => {
    const normalized = value.trim().replace(/^\/+|\/+$/g, '')
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{11,63}$/.test(normalized)) return
    entry.value = normalized
    if (import.meta.client) sessionStorage.setItem('security-entry', normalized)
  }

  const load = async () => {
    if (entry.value) return entry.value
    if (import.meta.client) {
      const stored = sessionStorage.getItem('security-entry') || ''
      if (/^[A-Za-z0-9][A-Za-z0-9_-]{11,63}$/.test(stored)) entry.value = stored
    }
    try {
      const res = await requestFetch<{ entry: string }>('/api/auth/entry')
      remember(res.entry || '')
    } catch {}
    return entry.value
  }

  return { entry, load, remember }
}
