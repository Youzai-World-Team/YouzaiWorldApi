import { requireAuth, requireFeaturePermission } from '../../../utils/db'
import { GAME_USERNAME_RE } from '../../../utils/game-input'
import { isMojangLookupDisabled, resolveMojangProfiles } from '../../../utils/mojang'

const MAX_USERNAMES = 60

/**
 * 向 Mojang 查询一批玩家代号的正版档案并写入缓存。属于只读查询，
 * 用 POST 只是为了在请求体里带玩家名单，因此在审计插件里被排除。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<any>(event)
  if (body?.refresh) requireFeaturePermission(event, 'game-cosmetics-refresh', 'edit')
  else requireAuth(event)
  if (isMojangLookupDisabled()) {
    throw createError({ statusCode: 503, message: '本实例已关闭 Mojang 查询（YZWC_MOJANG_DISABLED=1）' })
  }

  const raw = Array.isArray(body?.usernames) ? body.usernames : []
  if (!raw.length) throw createError({ statusCode: 400, message: '请至少提交一个玩家代号' })
  if (raw.length > MAX_USERNAMES) {
    throw createError({ statusCode: 400, message: `一次最多查询 ${MAX_USERNAMES} 个玩家代号` })
  }

  const seen = new Set<string>()
  const usernames: string[] = []
  for (const item of raw) {
    const username = String(item ?? '').trim()
    if (!GAME_USERNAME_RE.test(username)) {
      throw createError({ statusCode: 400, message: '玩家代号格式不正确' })
    }
    const key = username.toLocaleLowerCase('en-US')
    if (seen.has(key)) continue
    seen.add(key)
    usernames.push(username)
  }

  const resolved = await resolveMojangProfiles(usernames, Boolean(body?.refresh))
  const profiles = Object.fromEntries([...resolved.entries()].map(([key, profile]) => [key, {
    status: profile.status,
    username: profile.username,
    uuid: profile.profileUuid,
    skin_hash: profile.skinHash || null,
    cape_hash: profile.capeHash || null,
    model: profile.model || null,
    message: profile.message,
    checked_at: profile.checkedAt,
    stale: profile.stale,
  }]))
  return { profiles }
})
