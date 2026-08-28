import { getHeader, getRequestIP, type H3Event } from 'h3'
import { chatIpHash, getCachedIpLocation, setCachedIpLocation } from './db'

// 第三方中文 IP 库：HTTPS、免密钥，返回省市级归属地。
// 置 YZWC_IP_GEO_DISABLED=1 可整体跳过外呼，只用 Cloudflare 请求头兜底。
const IP_GEO_ENDPOINT = 'https://api.vore.top/api/IPdata'
const IP_GEO_TIMEOUT_MS = 3000
const LOCATION_MAX_LENGTH = 32

const COUNTRY_NAMES: Record<string, string> = {
  CN: '中国', HK: '中国香港', MO: '中国澳门', TW: '中国台湾',
  US: '美国', JP: '日本', KR: '韩国', SG: '新加坡',
  GB: '英国', DE: '德国', FR: '法国', CA: '加拿大',
  AU: '澳大利亚', RU: '俄罗斯', MY: '马来西亚', TH: '泰国',
  VN: '越南', PH: '菲律宾', ID: '印度尼西亚', IN: '印度',
  NL: '荷兰', IT: '意大利', ES: '西班牙', BR: '巴西',
  T1: 'Tor 网络',
}

interface IpDataResponse {
  code?: number
  ipdata?: {
    info1?: string
    info2?: string
    info3?: string
  }
}

function isPrivateAddress(ip: string): boolean {
  const address = ip.replace(/^::ffff:/i, '')
  if (address === '::1' || address === 'localhost') return true
  // IPv6 唯一本地地址与链路本地地址
  if (/^f[cd][0-9a-f]{2}:/i.test(address) || /^fe80:/i.test(address)) return true

  const parts = address.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map((part) => Number(part))
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false

  const [a, b] = octets as [number, number, number, number]
  if (a === 10 || a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  return false
}

function normalizeLocation(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, LOCATION_MAX_LENGTH)
}

async function lookupViaProvider(ip: string): Promise<string> {
  if (process.env.YZWC_IP_GEO_DISABLED === '1') return ''

  try {
    const response = await fetch(`${IP_GEO_ENDPOINT}?ip=${encodeURIComponent(ip)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(IP_GEO_TIMEOUT_MS),
    })
    if (!response.ok) return ''
    const result = await response.json() as IpDataResponse
    if (result.code !== 200) return ''

    const segments = [result.ipdata?.info1, result.ipdata?.info2]
      .map((segment) => String(segment || '').trim())
      .filter(Boolean)
    // info1 与 info2 在同城直辖市下会重复（如「上海市 上海市」），去重后拼接。
    const unique = segments.filter((segment, index) => segments.indexOf(segment) === index)
    return normalizeLocation(unique.join(' '))
  } catch {
    return ''
  }
}

function locationFromCloudflare(event: H3Event): string {
  const country = String(getHeader(event, 'cf-ipcountry') || '').trim().toUpperCase()
  if (!country || country === 'XX') return ''

  // cf-ipcity / cf-region 需在 Cloudflare 开启 Managed Transforms 才会下发。
  const city = String(getHeader(event, 'cf-ipcity') || '').trim()
  const region = String(getHeader(event, 'cf-region') || '').trim()
  const countryName = COUNTRY_NAMES[country] || country

  return normalizeLocation([countryName, region, city].filter(Boolean).join(' '))
}

function currentRequestIp(event: H3Event): string {
  return String(getHeader(event, 'cf-connecting-ip') || getRequestIP(event) || '').trim()
}

/**
 * 解析 IP 归属地，任何失败都退化成可展示的文本，绝不让发消息因此失败。
 * 顺序：私有网段 → 缓存 → 第三方省市级库（写缓存）→ Cloudflare 请求头（不写缓存）→ 未知
 */
export async function resolveIpLocation(ip: string, event: H3Event): Promise<string> {
  const address = String(ip || '').trim()
  if (!address || address === 'unknown') return '未知'
  if (isPrivateAddress(address)) return '局域网'

  const ipHash = chatIpHash(address)
  const cached = getCachedIpLocation(ipHash)
  if (cached) return cached

  const resolved = await lookupViaProvider(address)
  if (resolved) {
    setCachedIpLocation(ipHash, resolved)
    return resolved
  }

  // Cloudflare 请求头只描述当前请求，查询历史 IP 时不能拿它兜底。
  // 兜底结果粒度粗（多数只有国家），不写入缓存，以免占住 7 天 TTL。
  return address === currentRequestIp(event) ? locationFromCloudflare(event) || '未知' : '未知'
}

/**
 * 批量解析展示用归属地：私有地址与缓存不占外部查询额度，未命中的地址按传入顺序限量补查。
 */
export async function resolveIpLocations(
  ips: Array<string | null | undefined>,
  event: H3Event,
  maxLookups = 24,
): Promise<Map<string, string>> {
  const uniqueIps = [...new Set(ips.map((ip) => String(ip || '').trim()).filter((ip) => ip && ip !== 'unknown'))]
  const locations = new Map<string, string>()
  const unresolved: string[] = []

  for (const ip of uniqueIps) {
    if (isPrivateAddress(ip)) {
      locations.set(ip, '局域网')
      continue
    }
    const cached = getCachedIpLocation(chatIpHash(ip))
    if (cached) locations.set(ip, cached)
    else unresolved.push(ip)
  }

  const lookupLimit = Number.isFinite(maxLookups) ? Math.max(0, Math.trunc(maxLookups)) : 24
  const resolved = await Promise.all(unresolved.slice(0, lookupLimit).map(async (ip) => [ip, await resolveIpLocation(ip, event)] as const))
  for (const [ip, location] of resolved) {
    if (location && location !== '未知') locations.set(ip, location)
  }
  return locations
}
