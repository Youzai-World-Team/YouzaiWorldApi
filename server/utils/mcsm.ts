import { createError } from 'h3'
import { getMcsmConfig, type McsmConfig } from './db'

/**
 * MCSManager 面板客户端。
 * <p>
 * 面板的 ApiKey 等价于该账户的全部权限（发命令、改文件、停服），所以它只留在服务端：
 * 浏览器永远只跟本服务端的 {@code /api/admin/mcsm/*} 说话，由这里代为外呼并把 ApiKey
 * 拼进查询串。所有实例操作都必须先经过 {@link assertInstanceAllowed} 校验，
 * 确保 uuid / daemonId 确实属于该 ApiKey 名下的实例，避免后台用户拿别人的实例 ID 越权。
 * </p>
 */

const REQUEST_TIMEOUT_MS = 15_000
// 面板返回整份控制台历史，可达数十万字符，全量回传会把后台页面卡住，
// 因此用 size 参数只取末尾一段。
//
// size 的单位是**字符数**，不是官方文档写的「1KB ~ 2048KB」：传 1200 精确返回
// 1200 个字符，不带 size 才返回全部。按 KB 理解会让控制台只剩几百个字符，
// 所以这里按字符数处理，上限放到 50 万足够覆盖整份历史；万一以后面板真改成
// 按 KB，传大数也只是「取全部」，不会更糟。
const LOG_SIZE_MIN_CHARS = 1_000
const LOG_SIZE_MAX_CHARS = 500_000
const LOG_SIZE_DEFAULT_CHARS = 60_000
// 备份文件名由后台生成，只允许这一类；恢复和删除也只认这个模式，
// 避免把面板文件接口变成任意路径的删除工具。
export const MCSM_UUID_RE = /^[0-9a-f]{32}$/i

/** 面板实例状态码。-1 忙碌，0 停止，1 停止中，2 启动中，3 运行中。 */
export const INSTANCE_STATUS_LABELS: Record<number, string> = {
  '-1': '忙碌',
  0: '已停止',
  1: '停止中',
  2: '启动中',
  3: '运行中',
}

/** 面板账户等级：1 普通用户，10 管理员，-1 被封禁。 */
export const PANEL_PERMISSION_LABELS: Record<number, string> = {
  '-1': '已被面板封禁',
  1: '普通用户',
  10: '面板管理员',
}

export interface McsmPanelUser {
  userName: string
  permission: number
  permissionLabel: string
}

export interface McsmInstanceSummary {
  instanceUuid: string
  daemonId: string
  nickname: string
  status: number
  statusLabel: string
  hostIp: string
  remarks: string
  processType: string
  stopCommand: string
  lastDatetime: number
  endTime: number
  currentPlayers: number
  maxPlayers: number
  version: string
  latency: number
  online: boolean
}

export interface McsmInstanceDetail extends McsmInstanceSummary {
  started: number
  cwd: string
  type: string
  startCommandConfigured: boolean
  createDatetime: number
  storageUsage: number
  storageLimit: number
  processInfo: { cpu: number; memory: number; pid: number; elapsed: number }
  pingConfig: { ip: string; port: number }
  autoStart: boolean
  autoRestart: boolean
  enableRcon: boolean
  rconIp: string
  rconPort: number
  terminalOption: { haveColor: boolean; pty: boolean; ptyWindowCol: number; ptyWindowRow: number }
  fileCode: string
  crlf: number
}

function requireConfig(): McsmConfig {
  const config = getMcsmConfig()
  if (!config.baseUrl || !config.apiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'MCSM 面板尚未配置，请先在站点设置中填写面板地址与 ApiKey',
    })
  }
  return config
}

export function mcsmReady(): boolean {
  const config = getMcsmConfig()
  return Boolean(config.baseUrl && config.apiKey)
}

/**
 * 调用面板接口并拆掉 {@code {status,data,time}} 信封。
 * <p>
 * 面板把鉴权失败也用 200 外壳里的 {@code status} 表达，所以 HTTP 状态和信封都要判。
 * 抛出的错误信息里绝不会带上 ApiKey——它只出现在这里拼好的 URL 中。
 * </p>
 * <p>
 * 导出给同目录的 {@code mcsm-server-config.ts} 复用：面板接口都走这一个出口，
 * 免得 ApiKey 拼装和错误映射散落多处。
 * </p>
 */
export async function callPanel<T>(
  path: string,
  options: { method?: string; query?: Record<string, string | number | undefined>; body?: unknown } = {},
): Promise<T> {
  const config = requireConfig()
  const url = new URL(config.baseUrl + path)
  url.searchParams.set('apikey', config.apiKey)
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error: any) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    throw createError({
      statusCode: 504,
      statusMessage: timedOut ? 'MCSM 面板响应超时' : '无法连接 MCSM 面板，请检查面板地址与网络',
    })
  }

  if (response.status === 403) {
    throw createError({ statusCode: 502, statusMessage: 'MCSM 面板拒绝了请求：ApiKey 无效或权限不足' })
  }
  if (!response.ok) {
    throw createError({ statusCode: 502, statusMessage: `MCSM 面板返回异常状态 ${response.status}` })
  }

  let payload: any
  try {
    payload = await response.json()
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'MCSM 面板返回了无法解析的内容' })
  }

  if (Number(payload?.status) !== 200) {
    const detail = typeof payload?.data === 'string'
      ? payload.data
      : typeof payload?.data?.message === 'string'
        ? payload.data.message
        : typeof payload?.data?.error === 'string'
          ? payload.data.error
          : ''
    throw createError({
      statusCode: 502,
      statusMessage: `MCSM 面板返回错误${detail ? `：${detail}` : `（status ${payload?.status}）`}`,
    })
  }
  return payload.data as T
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function statusLabel(status: number): string {
  return INSTANCE_STATUS_LABELS[status] || '未知'
}

function mapSummary(raw: any): McsmInstanceSummary {
  const status = toNumber(raw?.status, 0)
  const info = raw?.info || {}
  const config = raw?.config || {}
  return {
    instanceUuid: String(raw?.instanceUuid || ''),
    daemonId: String(raw?.daemonId || ''),
    nickname: String(raw?.nickname ?? config.nickname ?? ''),
    status,
    statusLabel: statusLabel(status),
    hostIp: String(raw?.hostIp || ''),
    remarks: String(raw?.remarks || ''),
    processType: String(raw?.processType ?? config.processType ?? ''),
    stopCommand: String(raw?.stopCommand ?? config.stopCommand ?? ''),
    lastDatetime: toNumber(raw?.lastDatetime ?? config.lastDatetime),
    endTime: toNumber(raw?.endTime ?? config.endTime),
    currentPlayers: toNumber(info.currentPlayers, -1),
    maxPlayers: toNumber(info.maxPlayers, -1),
    version: String(info.version || ''),
    latency: toNumber(info.latency, -1),
    online: Boolean(info.mcPingOnline),
  }
}

/**
 * 列出该 ApiKey 名下的实例。
 * <p>
 * 用 {@code GET /api/auth}（当前账户信息）而不是 {@code /api/service/remote_service_instances}：
 * 后者要求面板管理员权限，普通账户的 ApiKey 会被 403；而账户信息里的 instances
 * 恰好就是「这把钥匙能碰的实例」，正好也是我们要暴露给后台的范围。请求 advanced
 * 信息是为了拿到普通用户可见的实时状态、玩家数和版本；凭据字段仍会在映射时丢弃。
 * </p>
 */
export async function getPanelSnapshot(): Promise<{ user: McsmPanelUser; instances: McsmInstanceSummary[] }> {
  const data = await callPanel<any>('/api/auth', { query: { uuid: '', advanced: 'true' } })
  const raw = Array.isArray(data?.instances) ? data.instances : []
  const permission = toNumber(data?.permission)
  return {
    user: {
      userName: String(data?.userName || ''),
      permission,
      permissionLabel: PANEL_PERMISSION_LABELS[permission] || `未知（${permission}）`,
    },
    // 面板返回的账户信息里还夹着 apiKey / secret / token 等字段，
    // 这里只挑实例元信息映射出去，避免顺手把面板凭据回传到浏览器。
    instances: raw
      .map(mapSummary)
      .filter((instance: McsmInstanceSummary) =>
        MCSM_UUID_RE.test(instance.instanceUuid) && MCSM_UUID_RE.test(instance.daemonId)),
  }
}

export async function listInstances(): Promise<McsmInstanceSummary[]> {
  return (await getPanelSnapshot()).instances
}

/**
 * 确认这对 uuid / daemonId 属于当前 ApiKey 名下的实例。
 * <p>
 * 每个写操作前都要过一遍：后台用户能自由填 uuid，不校验的话本服务端就成了
 * 「拿面板 ApiKey 打任意实例」的跳板。
 * </p>
 */
export async function assertInstanceAllowed(uuid: string, daemonId: string): Promise<McsmInstanceSummary> {
  if (!MCSM_UUID_RE.test(uuid) || !MCSM_UUID_RE.test(daemonId)) {
    throw createError({ statusCode: 400, statusMessage: '实例 ID 或节点 ID 格式不正确' })
  }
  const instances = await listInstances()
  const matched = instances.find((instance) =>
    instance.instanceUuid.toLowerCase() === uuid.toLowerCase()
    && instance.daemonId.toLowerCase() === daemonId.toLowerCase())
  if (!matched) {
    throw createError({ statusCode: 404, statusMessage: '该实例不在当前 MCSM ApiKey 的可管理范围内' })
  }
  return matched
}

export async function getInstanceDetail(uuid: string, daemonId: string): Promise<McsmInstanceDetail> {
  const summary = await assertInstanceAllowed(uuid, daemonId)
  const raw = await callPanel<any>('/api/instance', { query: { uuid, daemonId } })
  const config = raw?.config || {}
  const info = raw?.info || {}
  const runtime = raw?.processInfo || {}
  return {
    ...summary,
    ...mapSummary({ ...raw, daemonId, hostIp: summary.hostIp, remarks: summary.remarks }),
    started: toNumber(raw?.started),
    cwd: String(config.cwd || ''),
    type: String(config.type || ''),
    // 启动命令可能含有内网路径与 Java 参数，后台只需要知道「配好了没有」。
    startCommandConfigured: Boolean(String(config.startCommand || '').trim()),
    createDatetime: toNumber(config.createDatetime),
    storageUsage: toNumber(info.storageUsage),
    storageLimit: toNumber(info.storageLimit),
    processInfo: {
      cpu: toNumber(runtime.cpu),
      memory: toNumber(runtime.memory),
      pid: toNumber(runtime.pid),
      elapsed: toNumber(runtime.elapsed),
    },
    pingConfig: {
      ip: String(config.pingConfig?.ip || ''),
      port: toNumber(config.pingConfig?.port),
    },
    autoStart: Boolean(config.eventTask?.autoStart),
    autoRestart: Boolean(config.eventTask?.autoRestart),
    enableRcon: Boolean(config.enableRcon),
    rconIp: String(config.rconIp || ''),
    rconPort: toNumber(config.rconPort),
    terminalOption: {
      haveColor: Boolean(config.terminalOption?.haveColor),
      pty: Boolean(config.terminalOption?.pty),
      ptyWindowCol: toNumber(config.terminalOption?.ptyWindowCol, 120),
      ptyWindowRow: toNumber(config.terminalOption?.ptyWindowRow, 30),
    },
    fileCode: String(config.fileCode || 'utf-8'),
    crlf: toNumber(config.crlf),
  }
}

export type PowerAction = 'open' | 'stop' | 'restart' | 'kill'

const POWER_ACTIONS = new Set<PowerAction>(['open', 'stop', 'restart', 'kill'])

export const POWER_ACTION_LABELS: Record<PowerAction, string> = {
  open: '启动',
  stop: '停止',
  restart: '重启',
  kill: '强制结束进程',
}

export function isPowerAction(value: unknown): value is PowerAction {
  return POWER_ACTIONS.has(String(value ?? '') as PowerAction)
}

export async function runPowerAction(uuid: string, daemonId: string, action: PowerAction): Promise<void> {
  await callPanel<any>(`/api/protected_instance/${action}`, { query: { uuid, daemonId } })
}

const COMMAND_MAX_LENGTH = 512

/**
 * 校验要发给控制台的命令。
 * <p>
 * 命令是拼进查询串发给面板的，换行会被 pty 当成多条命令执行，
 * 所以换行和其他控制字符一律拒掉——一次请求只允许发一条命令。
 * </p>
 */
export function requireCommand(value: unknown): string {
  const command = String(value ?? '').trim()
  if (!command) {
    throw createError({ statusCode: 400, statusMessage: '命令不能为空' })
  }
  if (command.length > COMMAND_MAX_LENGTH) {
    throw createError({ statusCode: 400, statusMessage: `命令长度不能超过 ${COMMAND_MAX_LENGTH} 个字符` })
  }
  if (CONTROL_CHAR_PROBE_RE.test(command)) {
    throw createError({ statusCode: 400, statusMessage: '命令不能包含换行符或控制字符，一次只能发送一条命令' })
  }
  return command
}

export async function sendCommand(uuid: string, daemonId: string, command: string): Promise<void> {
  await callPanel<any>('/api/protected_instance/command', { query: { uuid, daemonId, command } })
}

/** 控制台输出：面板回的是带 ANSI 转义的原始终端流，清洗留给页面前的这一步。size 为字符数。 */
export async function fetchOutputLog(uuid: string, daemonId: string, sizeChars = LOG_SIZE_DEFAULT_CHARS): Promise<string> {
  const size = Math.min(LOG_SIZE_MAX_CHARS, Math.max(LOG_SIZE_MIN_CHARS, Math.trunc(sizeChars) || LOG_SIZE_DEFAULT_CHARS))
  const data = await callPanel<string>('/api/protected_instance/outputlog', { query: { uuid, daemonId, size } })
  return typeof data === 'string' ? data : ''
}

export interface StreamTicket {
  addr: string
  password: string
  prefix: string
}

/**
 * 换取实时控制台的流式票据。
 * <p>
 * 面板返回「守护进程地址 + 一次性密码」，真正的 stdout 推流走
 * 守护进程的 socket.io，而不是面板本身。本服务端用这张票据在服务端侧连守护进程，
 * 再把 stdout 通过 SSE 转发给浏览器——ApiKey 和节点地址都不出服务端。
 * </p>
 */
export async function openStreamTicket(uuid: string, daemonId: string): Promise<StreamTicket> {
  const data = await callPanel<any>('/api/protected_instance/stream_channel', {
    method: 'POST',
    query: { uuid, daemonId },
  })
  const addr = String(data?.addr || '')
  const password = String(data?.password || '')
  if (!addr || !password) {
    throw createError({ statusCode: 502, statusMessage: 'MCSM 面板没有返回实时控制台通道' })
  }
  return { addr, password, prefix: String(data?.prefix || '') }
}

// 面板开着 pty，输出里混着清行、光标移动、颜色和窗口标题序列，逐类去掉。
// OSC：ESC ] ... BEL / ESC \
const ANSI_OSC_RE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
// CSI：ESC [ 参数 中间字符 终止字符，覆盖 ESC[0K、ESC[1A、ESC[?25h、SGR 颜色等
const ANSI_CSI_RE = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g
// nF：ESC + 中间字符 + 终止字符，例如切换字符集的 ESC ( B
const ANSI_NF_RE = /\u001b[ -\/][0-~]/g
// 兜底：ESC 后跟单个终止字符（Fp/Fe/Fs），以及落单的 ESC
const ANSI_SINGLE_RE = /\u001b[0-~]?/g
// 除制表符和换行以外的 C0 控制字符（BEL、退格等）留在文本里只会显示成乱码
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
// 单次判定用的同集合正则（不带 g 标志）：带 g 的 test 会记住 lastIndex，反复调用结果不稳。
// 这里连换行和制表符一起算控制字符——命令里出现换行就等于一次发多条命令。
const CONTROL_CHAR_PROBE_RE = /[\u0000-\u001f\u007f]/

/**
 * 去掉 ANSI 转义并规整换行。
 * <p>
 * 面板开着 pty，输出里混着光标移动和清行序列（{@code ESC[0K}、{@code ESC[1A}）。
 * 直接展示会看到满屏乱码，这里只保留可读文本。pty 会按终端宽度硬折行，
 * 折行处插入的换行没法复原，和面板自己的网页控制台看到的一致。
 * </p>
 */
export function stripAnsi(text: string): string {
  return text
    .replace(ANSI_OSC_RE, '')
    .replace(ANSI_CSI_RE, '')
    .replace(ANSI_NF_RE, '')
    .replace(ANSI_SINGLE_RE, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(CONTROL_CHAR_RE, '')
}
