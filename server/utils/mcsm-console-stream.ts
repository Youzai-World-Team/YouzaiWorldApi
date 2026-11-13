import { createError } from 'h3'
import { openStreamTicket, stripAnsi } from './mcsm'

/**
 * 守护进程实时控制台的最小 socket.io 客户端。
 * <p>
 * MCSManager 的 stdout 推流走守护进程（节点）的 socket.io，用的是 engine.io v4
 * 协议。这里不引 socket.io-client（那是给浏览器的、还会拖一堆依赖），直接用
 * Node 内置的全局 {@link WebSocket} 按裸帧协议实现握手与鉴权——只需要覆盖
 * 「连接 → CONNECT → stream/auth → 收 instance/stdout」这一条链路。
 * </p>
 * <p>
 * 全程只在服务端发起：ApiKey 换来的一次性票据、节点明文地址都不出服务端，
 * 浏览器那头收到的是本服务端的 SSE。
 * </p>
 */

const AUTH_TIMEOUT_MS = 10_000

export interface ConsoleStream {
  close: () => void
}

interface ConsoleStreamHandlers {
  /** 已清洗的 stdout 文本片段。 */
  onText: (text: string) => void
  /** 通道关闭（对端断开、鉴权失败、网络错误），带一句原因。 */
  onClose: (reason: string) => void
}

/**
 * 连接某个实例的实时控制台，逐段回调 stdout。
 * <p>
 * 调用方拿到 {@link ConsoleStream#close} 后应在客户端断开时调用它，及时释放
 * 到守护进程的 WebSocket。鉴权超时或对端拒绝都会触发 {@code onClose}。
 * </p>
 */
export async function openConsoleStream(
  uuid: string,
  daemonId: string,
  handlers: ConsoleStreamHandlers,
): Promise<ConsoleStream> {
  const ticket = await openStreamTicket(uuid, daemonId)
  const wsUrl = `ws://${ticket.addr}${ticket.prefix || ''}/socket.io/?EIO=4&transport=websocket`

  const socket = new WebSocket(wsUrl)
  let closed = false
  let authed = false
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  function shutdown(reason: string) {
    if (closed) return
    closed = true
    clearTimeout(authTimer)
    if (!authed) rejectReady(new Error(reason))
    try {
      socket.close()
    } catch {
      // 已经关了就算了。
    }
    handlers.onClose(reason)
  }

  // 鉴权兜底：连上却迟迟不回 stream/auth 时不要把 SSE 一直挂着。
  const authTimer = setTimeout(() => {
    if (!authed) shutdown('实时控制台鉴权超时')
  }, AUTH_TIMEOUT_MS)

  socket.addEventListener('open', () => {
    // engine.io 握手由服务端先发 '0{...}'，这里等它。
  })

  socket.addEventListener('error', () => {
    clearTimeout(authTimer)
    shutdown('无法连接守护进程实时控制台')
  })

  socket.addEventListener('close', () => {
    clearTimeout(authTimer)
    shutdown('实时控制台连接已关闭')
  })

  socket.addEventListener('message', (event) => {
    const raw = typeof event.data === 'string' ? event.data : ''
    if (!raw) return

    // engine.io OPEN：握手包，回 socket.io CONNECT。
    if (raw.startsWith('0')) {
      trySend('40')
      return
    }

    // engine.io v4 由服务端发 PING，客户端只回 PONG；主动发 PING 会被节点断开。
    if (raw === '2') {
      trySend('3')
      return
    }

    // socket.io CONNECT 确认：发起 stream/auth 鉴权。
    if (raw.startsWith('40')) {
      trySend(`42${JSON.stringify(['stream/auth', { data: { password: ticket.password } }])}`)
      return
    }

    // socket.io EVENT。
    if (raw.startsWith('42')) {
      let frame: any
      try {
        frame = JSON.parse(raw.slice(2))
      } catch {
        return
      }
      const name = frame?.[0]
      const payload = frame?.[1]

      if (name === 'stream/auth') {
        const ok = payload?.data === true || payload === true
        if (ok) {
          authed = true
          clearTimeout(authTimer)
          resolveReady()
        } else {
          clearTimeout(authTimer)
          shutdown('守护进程拒绝了实时控制台鉴权')
        }
        return
      }

      if (name === 'instance/stdout') {
        // 校验实例，避免面板复用连接时把别的实例输出串进来。
        const data = payload?.data
        if (data && String(data.instanceUuid || '').toLowerCase() !== uuid.toLowerCase()) return
        const text = typeof data?.text === 'string' ? data.text : ''
        if (text) handlers.onText(stripAnsi(text))
      }
    }
  })

  function trySend(frame: string) {
    try {
      if (socket.readyState === socket.OPEN) socket.send(frame)
    } catch {
      shutdown('实时控制台写入失败')
    }
  }

  // 鉴权成功后接口才能上报「实时」，防止尚未连接就误报通道已打开。
  await ready
  return { close: () => shutdown('客户端断开') }
}

/** 供接口层探测：Node 运行时是否具备全局 WebSocket（Node 22 起内置）。 */
export function consoleStreamSupported(): boolean {
  return typeof WebSocket !== 'undefined'
}

export function requireConsoleStreamSupport(): void {
  if (!consoleStreamSupported()) {
    throw createError({ statusCode: 501, statusMessage: '当前运行时不支持实时控制台（缺少 WebSocket）' })
  }
}
