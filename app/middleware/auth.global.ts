export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const setup = await $fetch<{ initialized: boolean }>('/api/auth/setup').catch(() => null)
  if (setup && !setup.initialized) {
    if (to.path !== '/') return navigateTo('/')
    return
  }

  const isEntryRoute = to.name === 'entry'
  const access = useAdminAccess()
  let authenticated = false
  try {
    await access.load(true)
    authenticated = true
  } catch {
    access.clear()
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

  if (access.user.value?.passwordExpiry.expired && to.path !== '/account') {
    return navigateTo('/account')
  }

  await useEntry().load()
  if (access.levelForPath(to.path) === 'hidden') {
    return navigateTo(access.firstVisibleRoute.value)
  }
})
