import { requireGameApiKey, upsertGameStats } from '../../utils/db'

const MAX_BATCH = 500

/** 接收模组定期上传的统计增量；数据按玩家 UUID 和统计项目合并保存。 */
export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  const body = await readBody<any>(event)
  if (!Array.isArray(body?.players)) {
    throw createError({ statusCode: 400, statusMessage: '玩家统计列表格式不正确' })
  }
  if (body.players.length > MAX_BATCH) {
    throw createError({ statusCode: 400, statusMessage: `一次最多上传 ${MAX_BATCH} 位玩家` })
  }
  const mode = body?.mode === 'delta'
    ? 'delta'
    : body?.mode === 'reset'
      ? 'reset'
      : body?.mode == null || body?.mode === 'replace' ? 'replace' : null
  if (mode == null) {
    throw createError({ statusCode: 400, statusMessage: '统计同步模式不正确' })
  }
  const accepted = upsertGameStats(body.players.map((entry: any) => ({
    uuid: entry?.uuid,
    username: entry?.username,
    lastUpdated: entry?.last_updated,
    stats: entry?.stats,
  })), mode, body?.reset_id)
  return { ok: true, accepted, uploaded_at: Date.now() }
})
