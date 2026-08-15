export default defineEventHandler(async () => {
  const config = await readJson<{ entry?: string }>('config.json', { entry: '123456' })
  return { entry: config.entry || '123456' }
})
