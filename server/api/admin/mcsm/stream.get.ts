import { createEventStream } from 'h3'
import { requirePagePermission } from '../../../utils/db'
import { assertInstanceAllowed, fetchOutputLog, stripAnsi } from '../../../utils/mcsm'
import { openConsoleStream, requireConsoleStreamSupport } from '../../../utils/mcsm-console-stream'

/**
 * 实时控制台（SSE）。
 * <p>
 * 浏览器只跟本服务端说话：这里在服务端连守护进程的 socket.io 取 stdout 推流，
 * 再原样转成 SSE 事件。之所以不让浏览器直连守护进程——那是明文 {@code ws://}
 * 的第三方节点地址，HTTPS 页面会因混合内容被拦，页面 CSP 的 {@code connect-src 'self'}
 * 也不放行，而且节点地址随面板调度变动。
 * </p>
 * <p>
 * 事件：{@code history} 先补一段历史，{@code log} 是增量输出，
 * {@code status} 是通道状态，{@code ping} 是心跳（防中间代理按空闲掐断）。
 * </p>
 */

// 同时挂着的流数：每条流都占一个到守护进程的 WebSocket，给个上限免得被拖垮。
const MAX_CONCURRENT_STREAMS = 8
let activeStreams = 0

// 刷屏保护：崩服时的堆栈能一秒刷几百 KB，超预算就丢并告知，别把浏览器打死。
const BUDGET_WINDOW_MS = 10_000
const BUDGET_MAX_CHARS = 256 * 1024
const HEARTBEAT_MS = 25_000

export default defineEventHandler(async (event) => {
  requirePagePermission(event, 'server-manage', 'view')
  requireConsoleStreamSupport()

  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await assertInstanceAllowed(uuid, daemonId)

  if (activeStreams >= MAX_CONCURRENT_STREAMS) {
    throw createError({ statusCode: 503, statusMessage: '实时控制台连接数已达上限，请稍后再试' })
  }

  const historyChars = Number(query.history)
  const stream = createEventStream(event)
  activeStreams += 1

  let stopped = false
  let windowStart = Date.now()
  let windowChars = 0
  let dropped = false

  function push(name: string, payload: unknown) {
    if (stopped) return
    // push 是异步的，这里不 await：SSE 写入失败只会由 onClosed 收尾。
    void stream.push({ event: name, data: JSON.stringify(payload) }).catch(() => stop())
  }

  const heartbeat = setInterval(() => push('ping', { time: Date.now() }), HEARTBEAT_MS)

  function stop() {
    if (stopped) return
    stopped = true
    clearInterval(heartbeat)
    upstream?.close()
    void stream.close()
  }

  let upstream: { close: () => void } | null = null

  stream.onClosed(() => {
    if (!stopped) {
      stopped = true
      clearInterval(heartbeat)
      upstream?.close()
    }
    activeStreams = Math.max(0, activeStreams - 1)
  })

  // 先补一段历史，页面一打开就有上下文，不用等新输出。
  // 拉历史失败不影响后续推流，只提示一句。
  try {
    const raw = await fetchOutputLog(uuid, daemonId, Number.isFinite(historyChars) ? historyChars : undefined)
    push('history', { text: stripAnsi(raw) })
  } catch (error: any) {
    push('status', { state: 'warn', message: String(error?.statusMessage || '历史输出读取失败') })
  }

  try {
    upstream = await openConsoleStream(uuid, daemonId, {
      onText: (text) => {
        const now = Date.now()
        if (now - windowStart >= BUDGET_WINDOW_MS) {
          windowStart = now
          windowChars = 0
          dropped = false
        }
        windowChars += text.length
        if (windowChars > BUDGET_MAX_CHARS) {
          if (!dropped) {
            dropped = true
            push('status', { state: 'warn', message: '输出过快，已临时丢弃部分内容以保护页面' })
          }
          return
        }
        push('log', { text })
      },
      onClose: (reason) => {
        push('status', { state: 'closed', message: reason })
        stop()
      },
    })
    push('status', { state: 'open', message: '' })
  } catch (error: any) {
    push('status', { state: 'error', message: String(error?.statusMessage || '实时控制台连接失败') })
    stop()
  }

  return stream.send()
})
