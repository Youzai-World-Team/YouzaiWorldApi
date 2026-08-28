import { getAuditLogOverview, listAuditLogs, requireAuth } from '../../utils/db'
import { resolveIpLocations } from '../../utils/ip-location'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const query = getQuery(event)
  const limit = Number(query.limit)
  if (query.view === 'overview') {
    const overview = getAuditLogOverview(event, user, limit)
    const ips = [
      overview.currentAccount?.currentSession?.ip,
      ...overview.members.map((member) => member.lastConnection?.ip),
      ...overview.records.map((record) => record.ip),
    ]
    const locations = await resolveIpLocations(ips, event, 32)
    const enrich = <T extends { ip: string }>(value: T | null): (T & { location: string }) | null => (
      value ? { ...value, location: locations.get(value.ip) || '' } : null
    )
    return {
      ...overview,
      currentAccount: overview.currentAccount
        ? {
            ...overview.currentAccount,
            lastConnection: enrich(overview.currentAccount.lastConnection),
            currentSession: enrich(overview.currentAccount.currentSession),
          }
        : null,
      members: overview.members.map((member) => ({ ...member, lastConnection: enrich(member.lastConnection) })),
      records: overview.records.map((record) => ({ ...record, location: locations.get(record.ip) || '' })),
    }
  }
  return listAuditLogs(limit)
})
