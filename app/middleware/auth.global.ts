export default defineNuxtRouteMiddleware(async (to) => {
  const token = useCookie('youzai_token').value
  const isEntryRoute = to.name === 'entry'

  if (isEntryRoute) {
    if (token) return navigateTo('/')
    const { load } = useEntry()
    const entry = await load()
    if (to.path === '/' + entry) return
    return navigateTo('/' + entry)
  }

  if (!token) {
    const { load } = useEntry()
    const entry = await load()
    return navigateTo('/' + entry)
  }
})
