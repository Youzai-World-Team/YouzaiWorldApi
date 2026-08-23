import { getMojangProfileCache, upsertMojangProfileCache, type MojangProfileCache } from './db'

// 正版档案查询：服务器跑离线模式，账户表里只有离线 UUID，是否正版只能按玩家代号查 Mojang。
// 名称查询接口有速率限制（官方约 600 次 / 10 分钟），因此结果按玩家代号写入数据库缓存，
// 并在本进程内再加一层令牌桶，避免后台连续刷新把配额打满。
// 置 YZWC_MOJANG_DISABLED=1 可整体关闭外呼，只展示本地上传的外观。
const NAME_LOOKUP_ENDPOINT = 'https://api.mojang.com/users/profiles/minecraft/'
const NAME_LOOKUP_FALLBACK_ENDPOINT = 'https://api.minecraftservices.com/minecraft/profile/lookup/name/'
const SESSION_PROFILE_ENDPOINT = 'https://sessionserver.mojang.com/session/minecraft/profile/'
const TEXTURE_ENDPOINT = 'https://textures.minecraft.net/texture/'
const PROFILE_TIMEOUT_MS = 4000
const TEXTURE_TIMEOUT_MS = 6000
const TEXTURE_MAX_BYTES = 256 * 1024
const TEXTURE_CACHE_MAX = 64
const TEXTURE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX_LOOKUPS = 150
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Mojang 材质哈希：路径末段的十六进制串，也是我们唯一放行的代理入参。 */
export const TEXTURE_HASH_RE = /^[0-9a-f]{32,64}$/

const textureCache = new Map<string, { data: Buffer; expiresAt: number }>()
const lookupTimestamps: number[] = []

export function isMojangLookupDisabled(): boolean {
  return process.env.YZWC_MOJANG_DISABLED === '1'
}

function consumeLookupQuota(): boolean {
  const now = Date.now()
  while (lookupTimestamps.length && now - lookupTimestamps[0]! >= RATE_WINDOW_MS) {
    lookupTimestamps.shift()
  }
  if (lookupTimestamps.length >= RATE_MAX_LOOKUPS) return false
  lookupTimestamps.push(now)
  return true
}

async function fetchJson(url: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
  })
  if (response.status === 204 || response.status === 404) return { status: response.status, body: null }
  if (!response.ok) return { status: response.status, body: null }
  try {
    return { status: response.status, body: await response.json() }
  } catch {
    return { status: response.status, body: null }
  }
}

function dashedUuid(value: unknown): string | null {
  const raw = String(value ?? '').trim().toLowerCase().replace(/-/g, '')
  if (!/^[0-9a-f]{32}$/.test(raw)) return null
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`
}

function textureHashFromUrl(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    // 只接受官方材质域名，并且只留哈希：代理侧永远自己拼 URL，不会去请求第三方主机。
    if (url.hostname !== 'textures.minecraft.net') return ''
    const hash = url.pathname.split('/').pop()?.toLowerCase() ?? ''
    return TEXTURE_HASH_RE.test(hash) ? hash : ''
  } catch {
    return ''
  }
}

interface ProfileTextures {
  skinHash: string
  capeHash: string
  model: string
}

function parseTextureProperty(properties: unknown): ProfileTextures {
  const list = Array.isArray(properties) ? properties : []
  const property = list.find((item: any) => String(item?.name) === 'textures')
  if (!property) return { skinHash: '', capeHash: '', model: '' }
  let payload: any
  try {
    payload = JSON.parse(Buffer.from(String((property as any).value ?? ''), 'base64').toString('utf8'))
  } catch {
    return { skinHash: '', capeHash: '', model: '' }
  }
  const skin = payload?.textures?.SKIN
  const skinHash = textureHashFromUrl(skin?.url)
  const slim = String(skin?.metadata?.model ?? '').toLowerCase() === 'slim'
  return {
    skinHash,
    capeHash: textureHashFromUrl(payload?.textures?.CAPE?.url),
    model: skinHash ? (slim ? 'slim' : 'classic') : '',
  }
}

/** 依次尝试新旧两个名称查询接口，返回带横线的正版 UUID；查不到返回 null。 */
async function lookupPremiumUuid(username: string): Promise<{ uuid: string | null; failed: boolean }> {
  const encoded = encodeURIComponent(username)
  for (const endpoint of [NAME_LOOKUP_ENDPOINT, NAME_LOOKUP_FALLBACK_ENDPOINT]) {
    try {
      const { status, body } = await fetchJson(endpoint + encoded)
      if (status === 204 || status === 404) return { uuid: null, failed: false }
      const uuid = dashedUuid(body?.id)
      if (uuid) return { uuid, failed: false }
    } catch {
      // 单个接口超时或网络异常时继续尝试下一个。
    }
  }
  return { uuid: null, failed: true }
}

/**
 * 查询并缓存某个玩家代号的正版档案。
 * @param refresh 为真时忽略未过期的缓存，强制重新外呼。
 */
export async function resolveMojangProfile(
  username: string,
  refresh = false,
): Promise<MojangProfileCache | undefined> {
  const cached = getMojangProfileCache(username)
  if (cached && !refresh && !cached.stale) return cached
  if (isMojangLookupDisabled()) return cached
  if (!consumeLookupQuota()) {
    return cached ?? upsertMojangProfileCache({
      username, profileUuid: null, skinHash: '', capeHash: '', model: '',
      status: 'error', message: 'Mojang 查询过于频繁，请稍后再试',
    })
  }

  const { uuid, failed } = await lookupPremiumUuid(username)
  if (failed) {
    return upsertMojangProfileCache({
      username, profileUuid: cached?.profileUuid ?? null,
      skinHash: cached?.skinHash ?? '', capeHash: cached?.capeHash ?? '', model: cached?.model ?? '',
      status: 'error', message: '无法连接 Mojang 档案服务',
    })
  }
  if (!uuid) {
    return upsertMojangProfileCache({
      username, profileUuid: null, skinHash: '', capeHash: '', model: '',
      status: 'missing', message: '',
    })
  }

  try {
    const { body } = await fetchJson(`${SESSION_PROFILE_ENDPOINT}${uuid.replace(/-/g, '')}?unsigned=true`)
    const textures = parseTextureProperty(body?.properties)
    return upsertMojangProfileCache({
      username: String(body?.name || username),
      profileUuid: uuid,
      skinHash: textures.skinHash,
      capeHash: textures.capeHash,
      model: textures.model,
      status: 'premium',
      message: textures.skinHash ? '' : '正版账户使用默认皮肤',
    })
  } catch {
    return upsertMojangProfileCache({
      username, profileUuid: uuid, skinHash: '', capeHash: '', model: '',
      status: 'error', message: '无法读取 Mojang 材质信息',
    })
  }
}

/** 按材质哈希拉取官方 PNG，命中进程内缓存时不再外呼。哈希是内容寻址的，无需失效策略。 */
export async function fetchMojangTexture(hash: string): Promise<Buffer | undefined> {
  const key = hash.trim().toLowerCase()
  if (!TEXTURE_HASH_RE.test(key)) return undefined
  const now = Date.now()
  const cached = textureCache.get(key)
  if (cached && cached.expiresAt > now) return cached.data
  if (cached) textureCache.delete(key)
  if (isMojangLookupDisabled()) return undefined

  try {
    const response = await fetch(TEXTURE_ENDPOINT + key, {
      headers: { Accept: 'image/png' },
      signal: AbortSignal.timeout(TEXTURE_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const data = Buffer.from(await response.arrayBuffer())
    if (data.length < 33 || data.length > TEXTURE_MAX_BYTES || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return undefined
    }
    if (textureCache.size >= TEXTURE_CACHE_MAX) {
      const oldest = textureCache.keys().next()
      if (!oldest.done) textureCache.delete(oldest.value)
    }
    textureCache.set(key, { data, expiresAt: now + TEXTURE_CACHE_TTL_MS })
    return data
  } catch {
    return undefined
  }
}

/** 有并发上限地批量查询，避免一次刷新对 Mojang 造成突发流量。 */
export async function resolveMojangProfiles(
  usernames: string[],
  refresh = false,
  concurrency = 4,
): Promise<Map<string, MojangProfileCache>> {
  const results = new Map<string, MojangProfileCache>()
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, usernames.length)) }, async () => {
    while (cursor < usernames.length) {
      const username = usernames[cursor++]!
      const profile = await resolveMojangProfile(username, refresh)
      if (profile) results.set(username.toLocaleLowerCase('en-US'), profile)
    }
  })
  await Promise.all(workers)
  return results
}
