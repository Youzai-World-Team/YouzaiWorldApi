import { requireAuth } from '../../../utils/db'
import { assertInstanceAllowed, fetchOutputLog, stripAnsi } from '../../../utils/mcsm'

/**
 * 控制台输出快照。
 * <p>
 * 面板存的是整份终端历史，按 {@code size}（字符数）只取末尾一段，
 * 并在服务端剥掉 ANSI 转义——页面拿到的是纯文本，不需要在浏览器里再解析终端序列。
 * 实时输出走 {@code stream.get.ts} 的 SSE，这里只服务「暂停实时」后的手动刷新。
 * </p>
 */
export default defineEventHandler(async (event) => {
  requireAuth(event)
  const query = getQuery(event)
  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  await assertInstanceAllowed(uuid, daemonId)

  const size = Number(query.size)
  const raw = await fetchOutputLog(uuid, daemonId, Number.isFinite(size) ? size : undefined)
  return { text: stripAnsi(raw), rawBytes: raw.length }
})
