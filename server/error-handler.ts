import { setResponseHeader, setResponseStatus, send } from 'h3'

export default async function errorHandler(error: any, event: any) {
  const statusCode = error.statusCode || 500
  const statusMessage = error.statusMessage || 'Server Error'
  const isSensitive = error.unhandled || error.fatal
  const body = {
    error: true,
    url: event.path || '',
    statusCode,
    statusMessage,
    message: isSensitive ? 'Server Error' : error.message || error.toString(),
    data: isSensitive ? undefined : error.data
  }
  setResponseStatus(event, statusCode, statusMessage)
  setResponseHeader(event, 'Content-Type', 'application/json')
  return send(event, JSON.stringify(body))
}
