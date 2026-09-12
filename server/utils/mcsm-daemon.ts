import { createError } from 'h3'

interface DaemonAddress {
  addr?: unknown
  prefix?: unknown
}

interface FileTicket extends DaemonAddress {
  remoteMappings?: unknown
}

const ADDRESS_MAX_LENGTH = 2048
const SCHEME_RE = /^[a-z][a-z\d+.-]*:\/\//i

function invalidAddress(): never {
  throw createError({ statusCode: 502, statusMessage: 'MCSM 面板返回的节点地址格式无法识别' })
}

function httpUrl(value: unknown, fallbackProtocol: string): URL {
  if (typeof value === 'string' && /[\u0000-\u001f\u007f]/.test(value)) invalidAddress()
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.length > ADDRESS_MAX_LENGTH || /[\u0000-\u0020\u007f\\]/.test(raw)) invalidAddress()
  const normalized = raw.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:')
  let parsed: URL
  try {
    parsed = new URL(SCHEME_RE.test(normalized) ? normalized : fallbackProtocol + '//' + normalized)
  } catch {
    invalidAddress()
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname
    || parsed.username || parsed.password || parsed.search || parsed.hash) invalidAddress()
  return parsed
}

function prefixPath(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') invalidAddress()
  if (/[\u0000-\u001f\u007f]/.test(value)) invalidAddress()
  const raw = value.trim()
  if (raw.length > ADDRESS_MAX_LENGTH || /[\u0000-\u0020\u007f\\?#]/.test(raw)) invalidAddress()
  const parts = raw.split('/').filter(Boolean)
  if (parts.some(part => part === '.' || part === '..')) invalidAddress()
  return parts.length ? '/' + parts.join('/') : ''
}

function withPrefix(address: DaemonAddress, fallbackProtocol: string): URL {
  const parsed = httpUrl(address.addr, fallbackProtocol)
  const existing = parsed.pathname.replace(/\/+$/, '')
  const prefix = prefixPath(address.prefix)
  parsed.pathname = prefix && existing !== prefix && !existing.startsWith(prefix + '/') && !existing.endsWith(prefix)
    ? existing + prefix
    : existing
  return parsed
}

function authority(url: URL): string {
  return url.hostname.toLowerCase() + ':' + (url.port || (url.protocol === 'https:' ? '443' : '80'))
}

/** 按 ElementsPanel 的文件地址规则匹配映射，并将 ws/wss 转为实际传输用的 http/https。 */
export function resolveDaemonBase(ticket: FileTicket, panelBaseUrl: string): string {
  const panel = httpUrl(panelBaseUrl, 'http:')
  let address: DaemonAddress = ticket
  if (Array.isArray(ticket.remoteMappings)) {
    for (const entry of ticket.remoteMappings) {
      if (!entry || typeof entry !== 'object' || !entry.from || !entry.to) continue
      let from: URL
      try {
        from = withPrefix(entry.from, panel.protocol)
      } catch {
        continue
      }
      if (authority(from) === authority(panel)
        && from.pathname.replace(/\/+$/, '') === panel.pathname.replace(/\/+$/, '')) {
        address = entry.to
        break
      }
    }
  }
  const daemon = withPrefix(address, panel.protocol)
  // 票据中的回环地址是相对于面板主机的，不能指向另一台 API 主机自身。
  if (daemon.hostname === 'localhost' || /^127\./.test(daemon.hostname) || daemon.hostname === '[::1]') {
    daemon.hostname = panel.hostname
  }
  return daemon.origin + daemon.pathname.replace(/\/+$/, '')
}
