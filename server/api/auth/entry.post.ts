import { recordAudit, requireOwner, requireValidAdminEntry, setAdminEntry } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const user = requireOwner(event)

  const body = await readBody<{ entry?: string }>(event)
  const entry = requireValidAdminEntry(body.entry)

  setAdminEntry(entry)
  recordAudit(event, user, '修改后台安全入口')
  return { entry }
})
