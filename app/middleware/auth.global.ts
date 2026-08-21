export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const setup = await $fetch<{ initialized: boolean }>('/api/auth/setup').catch(() => null)
  if (setup && !setup.initialized) {
    if (to.path !== '/') return navigateTo('/')
    return
  }

  const isEntryRoute = to.name === 'entry'
  let authenticated = false
  try {
    await $fetch('/api/auth/me')
    authenticated = true
  } catch {
    authenticated = false
  }

  if (isEntryRoute) {
    if (authenticated) return navigateTo('/')
    return
  }

  if (!authenticated) {
    const { load } = useEntry()
    const entry = await load()
    if (entry) return navigateTo('/' + entry)
    return
  }

  await useEntry().load()
})
