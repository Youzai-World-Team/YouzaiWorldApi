import { createError } from 'h3'
import { getTurnstileConfig } from './db'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TURNSTILE_ACTION = 'login'
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

interface TurnstileVerifyResponse {
  success?: boolean
  action?: string
  hostname?: string
}

function expectedHostnames(): Set<string> {
  const hostnames = new Set(
    getTurnstileConfig().hostnames
      .split(',')
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
  )

  if (hostnames.size === 0) {
    throw createError({ statusCode: 503, statusMessage: 'Turnstile 允许的域名未配置' })
  }
  for (const hostname of hostnames) {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)
        && hostname !== '::1') {
      throw createError({ statusCode: 503, statusMessage: 'Turnstile 允许的域名配置无效' })
    }
  }
  if (process.env.NODE_ENV === 'production' && [...hostnames].some((hostname) => LOCAL_HOSTNAMES.has(hostname))) {
    throw createError({ statusCode: 503, statusMessage: '生产环境不能信任本地域名的 Turnstile 结果' })
  }
  return hostnames
}

export async function verifyTurnstileLogin(tokenValue: unknown, clientIp: string): Promise<void> {
  const token = typeof tokenValue === 'string' ? tokenValue.trim() : ''
  const secret = getTurnstileConfig().secret
  const hostnames = expectedHostnames()

  if (!secret) {
    throw createError({ statusCode: 503, statusMessage: 'Turnstile 服务端密钥未配置' })
  }
  if (!token || token.length > 2048) {
    throw createError({ statusCode: 403, statusMessage: '请完成人机验证' })
  }

  let result: TurnstileVerifyResponse
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: clientIp,
      }),
    })
    if (!response.ok) throw new Error(`siteverify ${response.status}`)
    result = await response.json() as TurnstileVerifyResponse
  } catch {
    throw createError({ statusCode: 403, statusMessage: '人机验证失败，请重试' })
  }

  const hostname = String(result.hostname || '').trim().toLowerCase()
  if (result.success !== true || result.action !== TURNSTILE_ACTION || !hostnames.has(hostname)) {
    throw createError({ statusCode: 403, statusMessage: '人机验证失败，请重试' })
  }
}
