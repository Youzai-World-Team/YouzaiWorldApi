import { clearStatusHistory, getStatusHistoryStats, recordAudit, requirePagePermission } from '../../utils/db'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const user = requirePagePermission(event, 'settings', 'edit')
  const removed = clearStatusHistory()
  recordAudit(event, user, `清除服务器状态历史（${removed} 条）`)
  return { ok: true, removed, stats: getStatusHistoryStats() }
})
