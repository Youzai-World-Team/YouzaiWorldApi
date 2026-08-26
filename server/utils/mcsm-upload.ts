import { createReadStream } from 'node:fs'
import { randomUUID } from 'node:crypto'

/**
 * 将一个原始文件流包装成 MCSManager 守护进程需要的 multipart 请求。
 * 文件本体不读入内存，调用方只需提供准确的字节数。
 */
export async function forwardFileUpload(
  url: string,
  source: NodeJS.ReadableStream,
  size: number,
  name: string,
): Promise<void> {
  const boundary = `----yzwapi${randomUUID().replace(/-/g, '')}`
  const encoder = new TextEncoder()
  const head = encoder.encode(
    `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="file"; filename="${name.replace(/["\\]/g, '_')}"\r\n`
    + 'Content-Type: application/octet-stream\r\n\r\n',
  )
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`)
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
        'Content-Length': String(head.byteLength + size + tail.byteLength),
      },
      body,
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
}

/** 通过临时文件读取，供分块上传完成后转发。 */
export function openStagedUpload(path: string): NodeJS.ReadableStream {
  return createReadStream(path)
}
