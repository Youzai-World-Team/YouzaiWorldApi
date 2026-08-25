import { randomUUID } from 'node:crypto'
import { recordAudit, requirePagePermission } from '../../../../utils/db'
import { assertInstanceAllowed } from '../../../../utils/mcsm'
import { fileUploadUrl, requireFileName, requireInstancePath, UPLOAD_MAX_BYTES } from '../../../../utils/mcsm-files'

/**
 * 上传文件：浏览器把原始字节 PUT 上来，这里现拼 multipart 转发给守护进程。
 * <p>
 * 为什么不让浏览器直接传给守护进程：票据里的节点地址是明文 http 的第三方主机，
 * HTTPS 后台页面过不了混合内容拦截，CSP 的 {@code connect-src 'self'} 也不放行。
 * </p>
 * <p>
 * 转发时**不缓冲**：请求体是 Node 的可读流，这里把 multipart 的头尾和它拼成一个
 * 新流，并按「头 + 文件体积 + 尾」精确算出 {@code Content-Length}——守护进程需要
 * 确定长度，用 chunked 传不一定认。所以体积由浏览器声明的 Content-Length 决定，
 * 与实际读到的字节数不一致时会由守护进程侧报错。
 * </p>
 */
export default defineEventHandler(async (event) => {
  const user = requirePagePermission(event, 'server-files', 'edit')
  const query = getQuery(event)

  const uuid = String(query.uuid || '')
  const daemonId = String(query.daemonId || '')
  const instance = await assertInstanceAllowed(uuid, daemonId)

  const dir = requireInstancePath(query.path)
  const name = requireFileName(query.name)

  const declared = Number(getHeader(event, 'content-length'))
  if (!Number.isFinite(declared) || declared <= 0) {
    throw createError({ statusCode: 411, statusMessage: '上传需要声明 Content-Length' })
  }
  if (declared > UPLOAD_MAX_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: `单个文件不能超过 ${Math.floor(UPLOAD_MAX_BYTES / 1024 / 1024)} MiB`,
    })
  }

  const { url } = await fileUploadUrl(uuid, daemonId, dir)

  // 守护进程要的是 multipart/form-data，字段名固定为 file。
  const boundary = `----yzwapi${randomUUID().replace(/-/g, '')}`
  const encoder = new TextEncoder()
  const head = encoder.encode(
    `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="file"; filename="${name.replace(/["\\]/g, '_')}"\r\n`
    + 'Content-Type: application/octet-stream\r\n\r\n',
  )
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`)

  const source = event.node.req
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(head)
      source.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
      source.on('end', () => {
        controller.enqueue(tail)
        controller.close()
      })
      source.on('error', (error) => controller.error(error))
    },
  })

  let upstream: Response
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(head.byteLength + declared + tail.byteLength),
      },
      body,
      // Node 的 fetch 用流做请求体时必须声明半双工。
      duplex: 'half',
      signal: AbortSignal.timeout(10 * 60 * 1000),
    } as RequestInit & { duplex: 'half' })
  } catch {
    throw createError({ statusCode: 504, statusMessage: '上传到守护进程失败或超时' })
  }

  const reply = (await upstream.text().catch(() => '')).trim()
  if (!upstream.ok || (reply && reply.toUpperCase() !== 'OK')) {
    throw createError({
      statusCode: 502,
      statusMessage: `守护进程拒绝了上传（${upstream.status}${reply ? `：${reply.slice(0, 80)}` : ''}）`,
    })
  }

  recordAudit(
    event,
    user,
    `上传文件到实例「${instance.nickname || uuid}」：${dir === '/' ? '' : dir}/${name}（${declared} 字节）`,
  )
  return { ok: true, path: dir === '/' ? `/${name}` : `${dir}/${name}` }
})
