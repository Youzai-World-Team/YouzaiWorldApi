export default defineEventHandler(async () => {
  return { entry: getSetting('entry') || '123456' }
})
