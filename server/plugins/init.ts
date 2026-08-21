import { migrateFromJson, validateRuntimeSecurityConfig } from '../utils/db'

export default defineNitroPlugin(async () => {
  await migrateFromJson()
  validateRuntimeSecurityConfig()
})
