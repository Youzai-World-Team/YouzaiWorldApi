const NODE_SERVICES_URL = 'https://api.eqad.fun/mcsm/api/services/'
const HISTORY_URL = 'https://api.eqad.fun/monitor'
const MINECRAFT_STATUS_URL = 'https://mcyzw.top/api/craftping/get_status'
const NODE_NAME = 'EQAD-003'
const MINECRAFT_HOST = 'play.mcyzw.top'
const MINECRAFT_PORT = 25565
const MAX_HISTORY_POINTS = 96
const REFRESH_AFTER_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 12_000

export interface StatusNode {
  nickname: string
  timestamp: number
  system: {
    type: string
    cpuUsage: number
    memUsage: number
  }
}

export interface MinecraftStatus {
  online: boolean
  host: string
  port: number
  players?: {
    online: number
    max: number
  }
  version?: string
  protocol?: number | string
  delay?: number
  error?: string
}

export interface AvailabilityPoint {
  time: number
  status: 'online' | 'offline'
}

export interface StatusSnapshot {
  generatedAt: number
  refreshAfterMs: number
  nodeName: string
  minecraftAddress: string
  node: StatusNode | null
  minecraft: MinecraftStatus | null
  history: AvailabilityPoint[]
  errors: Partial<Record<'node' | 'minecraft' | 'history', string>>
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === 'string' && value.trim() && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const timestamp = toFiniteNumber(value)
  return timestamp > 0 && timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function sourceError(error: unknown, source: string): string {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : ''
  if (name === 'TimeoutError' || name === 'AbortError') return `${source}响应超时`
  if (message === 'node not found' || message === 'history not found') {
    return `${source}中未找到 ${NODE_NAME}`
  }
  if (message === 'invalid node response') return `${source}返回格式异常`
  if (/^HTTP \d+$/.test(message)) {
    return `${source}返回异常状态 ${message.slice(5)}`
  }
  return `无法连接${source}`
}

export function normalizeNodeResponse(payload: unknown): StatusNode {
  const envelope = payload as { status?: unknown; data?: unknown }
  if (Number(envelope?.status) !== 200 || !Array.isArray(envelope?.data)) {
    throw new Error('invalid node response')
  }
  const raw = envelope.data.find((item: any) => String(item?.nickname || '') === NODE_NAME) as any
  if (!raw) throw new Error('node not found')
  return {
    nickname: NODE_NAME,
    timestamp: normalizeTimestamp(raw.timestamp),
    system: {
      type: String(raw.system?.type || '未知'),
      cpuUsage: toFiniteNumber(raw.system?.cpuUsage),
      memUsage: toFiniteNumber(raw.system?.memUsage),
    },
  }
}

export function normalizeMinecraftResponse(payload: unknown): MinecraftStatus {
  const raw = payload as any
  const online = raw?.online === true
  const players = online
    ? {
        online: Math.max(0, Math.trunc(toFiniteNumber(raw?.players?.online))),
        max: Math.max(0, Math.trunc(toFiniteNumber(raw?.players?.max))),
      }
    : undefined
  return {
    online,
    host: String(raw?.host || MINECRAFT_HOST),
    port: Math.max(1, Math.trunc(toFiniteNumber(raw?.port, MINECRAFT_PORT))),
    players,
    version: online && raw?.version != null ? String(raw.version) : undefined,
    protocol: online && raw?.protocol != null ? raw.protocol : undefined,
    delay: online ? Math.max(0, toFiniteNumber(raw?.round_trip_latency ?? raw?.delay)) : undefined,
    error: online ? undefined : String(raw?.error || '服务器离线'),
  }
}

export function normalizeHistoryResponse(payload: unknown): AvailabilityPoint[] {
  const records = (payload as Record<string, unknown> | null)?.[NODE_NAME]
  if (!Array.isArray(records)) throw new Error('history not found')
  return records
    .map((item: any): AvailabilityPoint | null => {
      const status = item?.status === 'online' ? 'online' : item?.status === 'offline' ? 'offline' : null
      const time = normalizeTimestamp(item?.time)
      return status && time > 0 ? { time, status } : null
    })
    .filter((item): item is AvailabilityPoint => item !== null)
    .sort((a, b) => a.time - b.time)
    .slice(-MAX_HISTORY_POINTS)
}

export async function getStatusSnapshot(): Promise<StatusSnapshot> {
  const [nodeResult, minecraftResult, historyResult] = await Promise.allSettled([
    requestJson(NODE_SERVICES_URL).then(normalizeNodeResponse),
    requestJson(MINECRAFT_STATUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: MINECRAFT_HOST, port: MINECRAFT_PORT }),
    }).then(normalizeMinecraftResponse),
    requestJson(HISTORY_URL, { cache: 'no-store' }).then(normalizeHistoryResponse),
  ])

  const errors: StatusSnapshot['errors'] = {}
  if (nodeResult.status === 'rejected') errors.node = sourceError(nodeResult.reason, '节点监控服务')
  if (minecraftResult.status === 'rejected') errors.minecraft = sourceError(minecraftResult.reason, 'Minecraft 状态服务')
  if (historyResult.status === 'rejected') errors.history = sourceError(historyResult.reason, '历史监控服务')

  return {
    generatedAt: Date.now(),
    refreshAfterMs: REFRESH_AFTER_MS,
    nodeName: NODE_NAME,
    minecraftAddress: `${MINECRAFT_HOST}:${MINECRAFT_PORT}`,
    node: nodeResult.status === 'fulfilled' ? nodeResult.value : null,
    minecraft: minecraftResult.status === 'fulfilled' ? minecraftResult.value : null,
    history: historyResult.status === 'fulfilled' ? historyResult.value : [],
    errors,
  }
}
