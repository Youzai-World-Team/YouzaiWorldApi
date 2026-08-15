export function useEntry() {
  const entry = useState<string>('security-entry', () => '')
  const requestFetch = useRequestFetch()

  const load = async () => {
    if (entry.value) return entry.value
    try {
      const res = await requestFetch<{ entry: string }>('/api/auth/entry')
      entry.value = res.entry || '123456'
    } catch {
      entry.value = '123456'
    }
    return entry.value
  }

  return { entry, load }
}
