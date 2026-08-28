import { once } from 'node:events'
import { createConnection, isIP, type Socket } from 'node:net'
import { hostname } from 'node:os'
import { connect as connectTls, type TLSSocket } from 'node:tls'
import { getVerificationEmailTemplates, type SmtpTransportSettings } from './db'
import {
  type VerificationEmailTemplate,
} from './email-templates'
import {
  buildVerificationEmailHtml,
  replaceVerificationEmailHtmlPlaceholders,
  VERIFICATION_EMAIL_LOGO_URL,
} from './email-template-renderer'
import { buildSmtpMessage, type HtmlEmailAttachment } from './smtp-message'

export type { HtmlEmailAttachment } from './smtp-message'

const SMTP_TIMEOUT_MS = 15_000

interface SmtpResponse {
  code: number
  lines: string[]
}

class SmtpResponseReader {
  private buffer = ''
  private currentLines: string[] = []
  private responses: SmtpResponse[] = []
  private waiters: Array<{
    resolve: (response: SmtpResponse) => void
    reject: (error: Error) => void
  }> = []
  private terminalError: Error | null = null

  private readonly onData = (chunk: Buffer | string) => {
    this.buffer += chunk.toString()
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      this.consumeLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private readonly onError = (error: Error) => this.fail(error)
  private readonly onClose = () => this.fail(new Error('SMTP 连接已关闭'))

  constructor(private readonly socket: Socket | TLSSocket) {
    socket.on('data', this.onData)
    socket.on('error', this.onError)
    socket.on('close', this.onClose)
  }

  read(): Promise<SmtpResponse> {
    const response = this.responses.shift()
    if (response) return Promise.resolve(response)
    if (this.terminalError) return Promise.reject(this.terminalError)
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
  }

  dispose(): void {
    this.socket.off('data', this.onData)
    this.socket.off('error', this.onError)
    this.socket.off('close', this.onClose)
  }

  private consumeLine(line: string): void {
    const match = /^(\d{3})([ -])(.*)$/.exec(line)
    if (!match) {
      if (this.currentLines.length) this.currentLines.push(line)
      return
    }
    this.currentLines.push(line)
    if (match[2] !== ' ') return
    const response = { code: Number(match[1]), lines: this.currentLines }
    this.currentLines = []
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve(response)
    else this.responses.push(response)
  }

  private fail(error: Error): void {
    if (this.terminalError) return
    this.terminalError = error
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }
}

function tlsServername(host: string): string | undefined {
  return isIP(host) === 0 ? host : undefined
}

function armTimeout(socket: Socket | TLSSocket): void {
  socket.setTimeout(SMTP_TIMEOUT_MS)
  socket.on('timeout', () => socket.destroy(new Error('SMTP 连接超时')))
}

async function openSocket(settings: SmtpTransportSettings): Promise<Socket | TLSSocket> {
  if (settings.security === 'tls') {
    const socket = connectTls({
      host: settings.host,
      port: settings.port,
      servername: tlsServername(settings.host),
      rejectUnauthorized: true,
    })
    armTimeout(socket)
    await once(socket, 'secureConnect')
    return socket
  }
  const socket = createConnection({ host: settings.host, port: settings.port })
  armTimeout(socket)
  await once(socket, 'connect')
  return socket
}

async function expectResponse(reader: SmtpResponseReader, expectedCodes: number[]): Promise<SmtpResponse> {
  const response = await reader.read()
  if (!expectedCodes.includes(response.code)) {
    const detail = response.lines.join(' ').slice(0, 500)
    throw new Error(`SMTP 返回异常（${response.code}）：${detail}`)
  }
  return response
}

async function command(
  socket: Socket | TLSSocket,
  reader: SmtpResponseReader,
  value: string,
  expectedCodes: number[],
): Promise<SmtpResponse> {
  socket.write(`${value}\r\n`, 'utf8')
  return expectResponse(reader, expectedCodes)
}

function hasCapability(response: SmtpResponse, capability: string): boolean {
  const target = capability.toUpperCase()
  return response.lines.some((line) => line.slice(4).trim().toUpperCase().startsWith(target))
}

function authCapabilities(response: SmtpResponse): string[] {
  const authLine = response.lines
    .map((line) => line.slice(4).trim())
    .find((line) => /^AUTH[ =]/i.test(line))
  return authLine ? authLine.replace(/^AUTH[ =]/i, '').trim().toUpperCase().split(/\s+/) : []
}

export function buildVerificationEmailFromTemplate(
  template: VerificationEmailTemplate,
  username: string,
  code: string,
  logoUrl = VERIFICATION_EMAIL_LOGO_URL,
): string {
  const resolved = resolveVerificationEmailTemplateValues(template, username, code)
  return resolved.html.trim()
    ? replaceVerificationEmailHtmlPlaceholders(resolved.html, resolved.subject, username, code, logoUrl)
    : buildVerificationEmailHtml(resolved.subject, username, code, resolved, logoUrl)
}

function resolveVerificationEmailTemplateValues(
  template: VerificationEmailTemplate,
  username: string,
  code: string,
): VerificationEmailTemplate {
  const replacePlaceholders = (value: string) => value
    .replaceAll('{{username}}', username)
    .replaceAll('{{code}}', code)
  return {
    ...template,
    subject: replacePlaceholders(template.subject),
    heading: replacePlaceholders(template.heading),
    intro: replacePlaceholders(template.intro),
    expiryNotice: replacePlaceholders(template.expiryNotice),
    details: template.details.map(replacePlaceholders),
  }
}

export function buildVerificationEmailText(
  template: VerificationEmailTemplate,
  username: string,
  code: string,
): string[] {
  const resolved = resolveVerificationEmailTemplateValues(template, username, code)
  return [
    `你好，${username}！`,
    resolved.intro,
    '',
    `验证码：${code}`,
    '',
    resolved.expiryNotice,
    ...resolved.details,
  ]
}

/**
 * Send an arbitrary HTML message through the configured SMTP transport.
 * The optional sender override is used by the domain-mail composer; callers
 * must validate the address before reaching this low-level function.
 */
export async function sendHtmlEmail(
  settings: SmtpTransportSettings,
  recipient: string,
  subject: string,
  htmlContent: string,
  textContent = '',
  sender?: { address: string; name?: string },
  attachments: HtmlEmailAttachment[] = [],
): Promise<void> {
  const effectiveSettings: SmtpTransportSettings = sender?.address
    ? { ...settings, fromAddress: sender.address, fromName: sender.name ?? settings.fromName }
    : settings
  const message = buildSmtpMessage(
    effectiveSettings,
    recipient,
    subject,
    textContent ? textContent.split(/\r?\n/) : [''],
    htmlContent,
    attachments,
  )
  return sendMessage(effectiveSettings, recipient, message)
}

function dotStuff(message: string): string {
  return message.split(/\r?\n/).map((line) => line.startsWith('.') ? `.${line}` : line).join('\r\n')
}

export async function sendRegistrationVerificationEmail(
  settings: SmtpTransportSettings,
  recipient: string,
  username: string,
  code: string,
): Promise<void> {
  const template = getVerificationEmailTemplates().registration
  const resolved = resolveVerificationEmailTemplateValues(template, username, code)
  const message = buildMessage(
    settings,
    recipient,
    resolved.subject,
    buildVerificationEmailText(template, username, code),
    buildVerificationEmailFromTemplate(template, username, code),
  )
  return sendMessage(settings, recipient, message)
}

export async function sendPasswordResetVerificationEmail(
  settings: SmtpTransportSettings,
  recipient: string,
  username: string,
  code: string,
): Promise<void> {
  const template = getVerificationEmailTemplates()['password-reset']
  const resolved = resolveVerificationEmailTemplateValues(template, username, code)
  const message = buildMessage(
    settings,
    recipient,
    resolved.subject,
    buildVerificationEmailText(template, username, code),
    buildVerificationEmailFromTemplate(template, username, code),
  )
  return sendMessage(settings, recipient, message)
}

export async function sendEmailChangeVerificationEmail(
  settings: SmtpTransportSettings,
  recipient: string,
  username: string,
  code: string,
): Promise<void> {
  const template = getVerificationEmailTemplates()['email-change']
  const resolved = resolveVerificationEmailTemplateValues(template, username, code)
  const message = buildMessage(
    settings,
    recipient,
    resolved.subject,
    buildVerificationEmailText(template, username, code),
    buildVerificationEmailFromTemplate(template, username, code),
  )
  return sendMessage(settings, recipient, message)
}

async function sendMessage(
  settings: SmtpTransportSettings,
  recipient: string,
  message: string,
): Promise<void> {
  if (settings.security === 'none' && settings.username) {
    throw new Error('拒绝通过未加密连接发送 SMTP 认证信息')
  }
  let socket: Socket | TLSSocket | null = null
  let reader: SmtpResponseReader | null = null
  try {
    socket = await openSocket(settings)
    reader = new SmtpResponseReader(socket)
    await expectResponse(reader, [220])

    const clientName = hostname().replace(/[^A-Za-z0-9.-]/g, '-') || 'localhost'
    let capabilities = await command(socket, reader, `EHLO ${clientName}`, [250])

    if (settings.security === 'starttls') {
      if (!hasCapability(capabilities, 'STARTTLS')) throw new Error('SMTP 服务器不支持 STARTTLS')
      await command(socket, reader, 'STARTTLS', [220])
      reader.dispose()
      socket.setTimeout(0)
      socket.removeAllListeners('timeout')
      socket = connectTls({
        socket,
        servername: tlsServername(settings.host),
        rejectUnauthorized: true,
      })
      armTimeout(socket)
      await once(socket, 'secureConnect')
      reader = new SmtpResponseReader(socket)
      capabilities = await command(socket, reader, `EHLO ${clientName}`, [250])
    }

    if (settings.username) {
      const methods = authCapabilities(capabilities)
      if (methods.includes('PLAIN')) {
        const payload = Buffer.from(`\0${settings.username}\0${settings.password}`, 'utf8').toString('base64')
        const response = await command(socket, reader, `AUTH PLAIN ${payload}`, [235, 334])
        if (response.code === 334) await command(socket, reader, payload, [235])
      } else if (methods.includes('LOGIN')) {
        await command(socket, reader, 'AUTH LOGIN', [334])
        await command(socket, reader, Buffer.from(settings.username, 'utf8').toString('base64'), [334])
        await command(socket, reader, Buffer.from(settings.password, 'utf8').toString('base64'), [235])
      } else {
        throw new Error('SMTP 服务器不支持 AUTH PLAIN 或 AUTH LOGIN')
      }
    }

    await command(socket, reader, `MAIL FROM:<${settings.fromAddress}>`, [250])
    await command(socket, reader, `RCPT TO:<${recipient}>`, [250, 251])
    await command(socket, reader, 'DATA', [354])
    socket.write(`${dotStuff(message)}\r\n.\r\n`, 'utf8')
    await expectResponse(reader, [250])
    try {
      await command(socket, reader, 'QUIT', [221])
    } catch {
      // DATA 已被服务器接受后，QUIT 失败不影响本次发送结果。
    }
  } finally {
    reader?.dispose()
    if (socket && !socket.destroyed) socket.destroy()
  }
}
