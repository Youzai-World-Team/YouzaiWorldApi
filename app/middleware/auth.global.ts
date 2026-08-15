export default defineNuxtRouteMiddleware(async (to) => {
  const token = useCookie('youzai_token').value

  if (to.name === 'entry') {
    if (token) return navigateTo('/')
    const { load } = useEntry()
    const entry = await load()
    if (to.path === '/' + entry) return
    throw createError({ statusCode: 404, statusMessage: '页面不存在', fatal: true })
  }

  if (!token) {
    throw createError({ statusCode: 404, statusMessage: '页面不存在', fatal: true })
  }
})
