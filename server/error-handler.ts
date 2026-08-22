import { setResponseHeader, setResponseStatus, send } from 'h3'

export default async function errorHandler(error: any, event: any) {
  const statusCode = error.statusCode || 500
  const isSensitive = error.unhandled || error.fatal
  const message = isSensitive ? 'Server Error' : error.message || error.statusMessage || error.toString()
  // 兼容仍读取 statusMessage 的现有客户端，但不再把业务错误文本写入 HTTP reason phrase。
  const statusMessage = isSensitive ? 'Server Error' : error.statusMessage || message
  const body = {
    error: true,
    url: event.path || '',
    statusCode,
    statusMessage,
    message,
    data: isSensitive ? undefined : error.data
  }
  setResponseStatus(event, statusCode)
  setResponseHeader(event, 'Content-Type', 'application/json')
  return send(event, JSON.stringify(body))
}
