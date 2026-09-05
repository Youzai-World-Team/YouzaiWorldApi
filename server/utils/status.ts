import {
  getLatestStatusHistorySnapshot,
  getStatusHistoryPoints,
  saveStatusHistorySamples,
  type StatusHistorySampleInput,
} from './db'
import { createError } from 'h3'

const STATUS_WORKER_URL = process.env.YZWC_STATUS_WORKER_URL?.trim() || 'https://status.mcyzw.top/api/status'
const MAX_HISTORY_POINTS = 96
const HISTORY_HOURS = 24
const REFRESH_AFTER_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 12_000
const STATUS_BUCKET_MS = 5 * 60 * 1000
const NODE_NAME = 'EQAD-003'
const MINECRAFT_HOST = 'play.mcyzw.top'
const MINECRAFT_PORT = 25565

export interface StatusNode {
  nickname: string
  timestamp: number
  system: { type: string; cpuUsage: number; memUsage: number }
}

export interface MinecraftStatus {
  online: boolean
  host: string
  port: number
  players?: { online: number; max: number }
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
  errors: Partial<Record<'node' | 'minecraft' | 'history' | 'storage' | 'worker', string>>
  stale?: boolean
}

interface WorkerStatusResponse {
  generatedAt?: unknown
  refreshAfterMs?: unknown
  overall?: unknown
  node?: any
  minecraft?: any
  history?: unknown
  errors?: Record<string, unknown>
  stale?: unknown
}

interface WorkerHistoryResponse { samples?: any[] }

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

function statusWorkerHistoryUrl(): string {
  const url = new URL(STATUS_WORKER_URL)
  const pathname = url.pathname.replace(/\/+$/, '')
  if (pathname.endsWith('/api/status/history')) return url.toString()
  url.pathname = pathname.endsWith('/api/status')
    ? `${pathname}/history`
    : `${pathname}/api/status/history`
  return url.toString()
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function sourceError(error: unknown, source: string): string {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : ''
  if (name === 'TimeoutError' || name === 'AbortError') return `${source}响应超时`
  if (/^HTTP \d+$/.test(message)) return `${source}返回异常状态 ${message.slice(5)}`
  return `无法连接${source}`
}

export function normalizeNodeResponse(payload: unknown): StatusNode {
  const workerNode = (payload as WorkerStatusResponse)?.node
  const legacyEnvelope = payload as { status?: unknown; data?: unknown }
  const legacyNode = Array.isArray(legacyEnvelope?.data)
    ? legacyEnvelope.data.find((item: any) => String(item?.nickname || '') === NODE_NAME)
    : null
  const raw = workerNode || legacyNode
  if (!raw || typeof raw !== 'object') throw new Error('invalid node response')
  const status = String(raw.status || 'unknown')
  if (workerNode && (status === 'outage' || status === 'unknown')) throw new Error('node unavailable')
  // Keep the API's existing node contract (0..1 ratios). The Worker exposes
  // human-readable percentages (0..100), while the legacy source used ratios.
  const cpuUsage = toFiniteNumber(raw.cpuUsage ?? raw.system?.cpuUsage)
  const memUsage = toFiniteNumber(raw.memoryUsage ?? raw.system?.memUsage)
  return {
    nickname: String(raw.name || raw.nickname || NODE_NAME),
    timestamp: normalizeTimestamp(raw.timestamp),
    system: {
      type: String(raw.systemType || raw.system?.type || '未知'),
      cpuUsage: workerNode ? cpuUsage / 100 : cpuUsage,
      memUsage: workerNode ? memUsage / 100 : memUsage,
    },
  }
}

export function normalizeMinecraftResponse(payload: unknown): MinecraftStatus {
  const raw = (payload as WorkerStatusResponse)?.minecraft ?? payload
  const online = raw?.online === true
  const players = online
    ? {
        online: Math.max(0, Math.trunc(toFiniteNumber(raw?.playersOnline ?? raw?.players?.online))),
        max: Math.max(0, Math.trunc(toFiniteNumber(raw?.playersMax ?? raw?.players?.max))),
      }
    : undefined
  const address = String(raw?.address || raw?.host || MINECRAFT_HOST)
  return {
    online,
    host: address.includes(':') ? (address.split(':')[0] || MINECRAFT_HOST) : address,
    port: Math.max(1, Math.trunc(toFiniteNumber(raw?.port, MINECRAFT_PORT))),
    players,
    version: online && raw?.version != null ? String(raw.version) : undefined,
    protocol: online && raw?.protocol != null ? raw.protocol : undefined,
    delay: online ? Math.max(0, toFiniteNumber(raw?.latencyMs ?? raw?.delay)) : undefined,
    error: online ? undefined : String(raw?.message || raw?.error || '服务器离线'),
  }
}

export function normalizeHistoryResponse(payload: unknown): AvailabilityPoint[] {
  const workerHistory = (payload as WorkerStatusResponse)?.history
  const workerSamples = (payload as WorkerHistoryResponse)?.samples
  const legacyHistory = (payload as Record<string, unknown> | null)?.[NODE_NAME]
  const records: any[] = Array.isArray(workerHistory)
    ? workerHistory as any[]
    : Array.isArray(workerSamples)
      ? workerSamples.map((sample: any) => ({
          time: sample?.capturedAt,
          status: sample?.node?.status === 'operational' || sample?.node?.status === 'degraded'
            ? 'online'
            : sample?.node ? 'offline' : sample?.status,
        }))
      : Array.isArray(legacyHistory) ? legacyHistory : []
  return records
    .map((item: any): AvailabilityPoint | null => {
      const time = normalizeTimestamp(item?.time)
      const status = item?.status === 'online' ? 'online' : item?.status === 'offline' ? 'offline' : null
      return status && time > 0 ? { time, status } : null
    })
    .filter((item: AvailabilityPoint | null): item is AvailabilityPoint => item !== null)
    .sort((a: AvailabilityPoint, b: AvailabilityPoint) => a.time - b.time)
    .slice(-MAX_HISTORY_POINTS)
}

function sampleFromWorker(sample: any): StatusHistorySampleInput | null {
  const capturedAt = normalizeTimestamp(sample?.capturedAt)
  if (!capturedAt) return null
  const node = sample?.node ?? null
  const minecraft = sample?.minecraft ?? null
  return {
    capturedAt,
    overall: String(sample?.overall || 'unknown'),
    nodeStatus: String(node?.status || 'unknown'),
    minecraftStatus: String(minecraft?.status || (minecraft?.online ? 'operational' : 'outage')),
    snapshot: sample,
  }
}

function sampleFromCurrent(payload: WorkerStatusResponse, generatedAt: number): StatusHistorySampleInput {
  return {
    capturedAt: Math.floor(generatedAt / STATUS_BUCKET_MS) * STATUS_BUCKET_MS,
    overall: String(payload.overall || 'unknown'),
    nodeStatus: String(payload.node?.status || 'unknown'),
    minecraftStatus: String(payload.minecraft?.status || (payload.minecraft?.online ? 'operational' : 'outage')),
    snapshot: payload,
  }
}

export async function getStatusSnapshot(): Promise<StatusSnapshot> {
  let workerPayload: WorkerStatusResponse
  try {
    workerPayload = await requestJson(STATUS_WORKER_URL) as WorkerStatusResponse
  } catch (error) {
    let fallbackPayload: WorkerStatusResponse | null = null
    try {
      fallbackPayload = getLatestStatusHistorySnapshot() as WorkerStatusResponse | null
    } catch {
      // A database lock or a startup race must not hide the original Worker
      // error; the normal 502 below remains the most useful response.
    }
    if (fallbackPayload && typeof fallbackPayload === 'object') {
      const fallbackGeneratedAt = normalizeTimestamp(
        fallbackPayload.generatedAt ?? (fallbackPayload as WorkerStatusResponse & { capturedAt?: unknown }).capturedAt,
      ) || Date.now()
      const fallbackErrors: StatusSnapshot['errors'] = {
        worker: `${sourceError(error, '状态 Worker')}，当前显示最近一次成功数据`,
      }
      let fallbackNode: StatusNode | null = null
      let fallbackMinecraft: MinecraftStatus | null = null
      try {
        fallbackNode = normalizeNodeResponse(fallbackPayload)
      } catch {
        fallbackErrors.node = String(fallbackPayload.errors?.node || '节点监控暂不可用')
      }
      try {
        fallbackMinecraft = normalizeMinecraftResponse(fallbackPayload)
      } catch {
        fallbackErrors.minecraft = String(fallbackPayload.errors?.minecraft || 'Minecraft 状态暂不可用')
      }
      let fallbackHistory: AvailabilityPoint[] = []
      try {
        fallbackHistory = getStatusHistoryPoints(
          Date.now() - HISTORY_HOURS * 60 * 60 * 1000,
          MAX_HISTORY_POINTS,
        )
      } catch {
        // Keep the last snapshot visible even if the history table is locked.
      }
      if (!fallbackHistory.length && Array.isArray(fallbackPayload.history)) {
        fallbackHistory.push(...normalizeHistoryResponse(fallbackPayload))
      }
      return {
        generatedAt: fallbackGeneratedAt,
        refreshAfterMs: toFiniteNumber(fallbackPayload.refreshAfterMs, REFRESH_AFTER_MS),
        nodeName: NODE_NAME,
        minecraftAddress: `${MINECRAFT_HOST}:${MINECRAFT_PORT}`,
        node: fallbackNode,
        minecraft: fallbackMinecraft,
        history: fallbackHistory,
        errors: fallbackErrors,
        stale: true,
      }
    }
    throw createError({ statusCode: 502, statusMessage: sourceError(error, '状态 Worker') })
  }

  const generatedAt = normalizeTimestamp(workerPayload.generatedAt) || Date.now()
  const errors: StatusSnapshot['errors'] = {}
  for (const key of ['node', 'minecraft', 'history', 'storage', 'worker'] as const) {
    const message = workerPayload.errors?.[key]
    if (typeof message === 'string' && message) errors[key] = message
  }
  let node: StatusNode | null = null
  let minecraft: MinecraftStatus | null = null
  try {
    node = normalizeNodeResponse(workerPayload)
  } catch {
    errors.node = String(workerPayload.errors?.node || '节点监控暂不可用')
  }
  try {
    minecraft = normalizeMinecraftResponse(workerPayload)
  } catch {
    errors.minecraft = String(workerPayload.errors?.minecraft || 'Minecraft 状态暂不可用')
  }

  let historySamples: StatusHistorySampleInput[] = []
  try {
    const historyPayload = await requestJson(statusWorkerHistoryUrl()) as WorkerHistoryResponse
    historySamples = (Array.isArray(historyPayload.samples) ? historyPayload.samples : [])
      .map(sampleFromWorker)
      .filter((sample): sample is StatusHistorySampleInput => sample !== null)
  } catch (error) {
    errors.history = sourceError(error, '状态历史服务')
  }
  // Always include the current response. The history endpoint may be served from
  // an edge cache and therefore omit the sample just captured by /api/status.
  historySamples.push(sampleFromCurrent(workerPayload, generatedAt))

  try {
    saveStatusHistorySamples(historySamples)
  } catch (error) {
    errors.storage = sourceError(error, '状态历史数据库')
  }

  let history: AvailabilityPoint[] = []
  try {
    history = getStatusHistoryPoints(Date.now() - HISTORY_HOURS * 60 * 60 * 1000, MAX_HISTORY_POINTS)
  } catch (error) {
    errors.storage = sourceError(error, '状态历史数据库')
  }
  if (!history.length && Array.isArray(workerPayload.history)) history.push(...normalizeHistoryResponse(workerPayload))
  return {
    generatedAt,
    refreshAfterMs: toFiniteNumber(workerPayload.refreshAfterMs, REFRESH_AFTER_MS),
    nodeName: NODE_NAME,
    minecraftAddress: `${MINECRAFT_HOST}:${MINECRAFT_PORT}`,
    node,
    minecraft,
    history,
    errors,
    stale: workerPayload.stale === true,
  }
}
