import { createError } from 'h3'
import { getChatTurnstileConfig, getTurnstileConfig, type TurnstileConfig, type TurnstileScope } from './db'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

interface TurnstileVerifyResponse {
  success?: boolean
  action?: string
  hostname?: string
  'error-codes'?: string[]
}

function configFor(scope: TurnstileScope): TurnstileConfig {
  return scope === 'chat' ? getChatTurnstileConfig() : getTurnstileConfig()
}

function expectedHostnames(config: TurnstileConfig): Set<string> {
  const hostnames = new Set(
    config.hostnames
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

/**
 * 校验 Turnstile 令牌。action 必须与前端 widget 渲染时传入的一致，
 * 避免把某个场景（如登录）拿到的令牌复用到另一个场景（如聊天发言）。
 */
async function verifyTurnstile(
  tokenValue: unknown,
  clientIp: string,
  action: string,
  scope: TurnstileScope,
): Promise<void> {
  const token = typeof tokenValue === 'string' ? tokenValue.trim() : ''
  const config = configFor(scope)
  const hostnames = expectedHostnames(config)

  if (!config.secret) {
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
        secret: config.secret,
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
  if (result.success !== true || result.action !== action || !hostnames.has(hostname)) {
    // 配置类错误（域名没登记、密钥配错）与用户真的没通过很难从前端区分，
    // 这里把判定依据打到服务端日志，便于排查“明明通过了却被拒”的情况。
    console.warn('[turnstile] 校验未通过', {
      scope,
      expectedAction: action,
      actualAction: result.action,
      hostname,
      allowedHostnames: [...hostnames],
      success: result.success,
      errorCodes: result['error-codes'],
    })
    throw createError({ statusCode: 403, statusMessage: '人机验证失败，请重试' })
  }
}

export function verifyTurnstileLogin(tokenValue: unknown, clientIp: string): Promise<void> {
  return verifyTurnstile(tokenValue, clientIp, 'login', 'admin')
}

/** 聊天区发言（chat）与玩家登录（chat-login）共用聊天区那套凭据。 */
export function verifyTurnstileChat(tokenValue: unknown, clientIp: string, action: string): Promise<void> {
  return verifyTurnstile(tokenValue, clientIp, action, 'chat')
}
