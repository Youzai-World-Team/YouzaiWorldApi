export default defineNitroPlugin(async () => {
  await migrateFromJson()
})
