import { requireValidAdminEntry, setAdminEntry } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireAuth(event)

  const body = await readBody<{ entry?: string }>(event)
  const entry = requireValidAdminEntry(body.entry)

  setAdminEntry(entry)
  return { entry }
})
