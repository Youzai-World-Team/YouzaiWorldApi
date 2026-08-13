export default defineNuxtRouteMiddleware((to) => {
  const token = useCookie('youzai_token').value

  if (!token && to.path !== '/login') {
    return navigateTo('/login')
  }
  if (token && to.path === '/login') {
    return navigateTo('/')
  }
})
