import { listGameAccounts, listGameStats, requirePagePermission } from '../../utils/db'

export default defineEventHandler((event) => {
  requirePagePermission(event, 'game-stats', 'view')

  const allStats = listGameStats()
  const statsByUuid = new Map(allStats.map((record) => [record.uuid, record]))
  const claimed = new Set<string>()
  const accounts = listGameAccounts().map((account) => {
    const uuid = String(account.uuid ?? '').toLowerCase()
    if (uuid) claimed.add(uuid)
    const record = statsByUuid.get(uuid)
    return {
      username: account.username,
      uuid: account.uuid,
      registered: Boolean(account.password),
      stats: record?.stats ?? {},
      last_updated: record?.lastUpdated ?? 0,
      uploaded_at: record?.uploadedAt ?? 0,
    }
  })

  const orphans = allStats
    .filter((record) => !claimed.has(record.uuid))
    .map((record) => ({
      uuid: record.uuid,
      username: record.username,
      stats: record.stats,
      last_updated: record.lastUpdated,
      uploaded_at: record.uploadedAt,
    }))

  return { accounts, orphans }
})
