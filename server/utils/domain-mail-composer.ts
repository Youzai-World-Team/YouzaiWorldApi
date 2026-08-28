import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createError } from 'h3'

export interface DomainMailTemplateData {
  subject: string
  preheader: string
  eyebrow: string
  heading: string
  greeting: string
  body: string
  senderName: string
  senderRole: string
}

const DOMAIN_MAIL_SOURCE_GUIDES: Record<keyof DomainMailTemplateData, string> = {
  subject: 'HTML 文档标题；实际邮件主题请使用写信窗口顶部的“主题”输入框',
  preheader: '邮箱邮件列表中显示的预览摘要',
  eyebrow: '眉题，例如通知类型或栏目名称',
  heading: '邮件正文标题',
  greeting: '问候语',
  body: '邮件正文，可在此注释后填写文本或行内 HTML',
  senderName: '署名',
  senderRole: '署名职位',
}

interface DomainMailCompositionInput {
  mode?: unknown
  fields?: unknown
  html?: unknown
}

export const DOMAIN_MAIL_HTML_MAX_BYTES = 512 * 1024

function htmlByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function templateCandidates(): string[] {
  const configured = String(process.env.YZWC_REPLY_TEMPLATE_PATH || '').trim()
  return [configured, path.resolve(process.cwd(), 'reply.html'), path.resolve(process.cwd(), '..', 'reply.html')]
    .filter(Boolean)
}

export async function readDomainMailTemplate(): Promise<string> {
  const filename = templateCandidates().find((candidate) => existsSync(candidate))
  if (!filename) throw createError({ statusCode: 503, statusMessage: '默认邮件模板不存在' })
  const html = await readFile(filename, 'utf8')
  if (!html.trim() || htmlByteLength(html) > DOMAIN_MAIL_HTML_MAX_BYTES) {
    throw createError({ statusCode: 503, statusMessage: '默认邮件模板为空或过大' })
  }
  return html
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] || char)
}

function stripTags(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function defaultDomainMailTemplateData(): DomainMailTemplateData {
  return {
    subject: '',
    preheader: '',
    eyebrow: '',
    heading: '',
    greeting: '',
    body: '',
    senderName: '',
    senderRole: '',
  }
}

/** Build an editable source-mode starter without leaving visible placeholder text in the email. */
export function buildDomainMailSourceTemplate(html: string): string {
  return html.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (placeholder, field: string) => {
    const guide = DOMAIN_MAIL_SOURCE_GUIDES[field as keyof DomainMailTemplateData]
    return guide ? `<!-- [编辑指引：${guide}] -->` : placeholder
  })
}

function tagContents(html: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  return [...html.matchAll(pattern)].map((match) => match[1] || '')
}

function fieldContent(html: string, field: keyof DomainMailTemplateData): string | undefined {
  const pattern = new RegExp(
    `<([A-Za-z][\\w:-]*)\\b[^>]*\\bdata-yzw-field\\s*=\\s*(["'])${field}\\2[^>]*>([\\s\\S]*?)<\\/\\1>`,
    'i',
  )
  return pattern.exec(html)?.[3]
}

function parsedText(value: string | undefined, fallback: string): string {
  const text = value ? stripTags(value) : ''
  return text && !/^\{\{[A-Za-z][A-Za-z0-9]*\}\}$/.test(text) ? text : fallback
}

/** Read common editable fields from the default HTML document. */
export function parseDomainMailTemplate(html: string): DomainMailTemplateData {
  const defaults = defaultDomainMailTemplateData()
  const paragraphs = tagContents(html, 'p')
    .map((value) => stripTags(value))
    .filter(Boolean)
  const fallbackPreheader = /<div\b[^>]*display\s*:\s*none[\s\S]*?>([\s\S]*?)<\/div>/i.exec(html)?.[1]
  const fallbackEyebrow = tagContents(html, 'div')
    .find((value) => /\{\{eyebrow\}\}|\bRE:/i.test(stripTags(value)))

  return {
    subject: parsedText(fieldContent(html, 'subject') || tagContents(html, 'title')[0], defaults.subject),
    preheader: parsedText(fieldContent(html, 'preheader') || fallbackPreheader, defaults.preheader),
    eyebrow: parsedText(fieldContent(html, 'eyebrow') || fallbackEyebrow, defaults.eyebrow),
    heading: parsedText(fieldContent(html, 'heading') || tagContents(html, 'h1')[0], defaults.heading),
    greeting: parsedText(fieldContent(html, 'greeting') || paragraphs[0], defaults.greeting),
    body: parsedText(fieldContent(html, 'body') || paragraphs[1], defaults.body),
    senderName: parsedText(fieldContent(html, 'senderName'), defaults.senderName),
    senderRole: parsedText(fieldContent(html, 'senderRole'), defaults.senderRole),
  }
}

export function renderDomainMailTemplate(html: string, input: Partial<DomainMailTemplateData>): {
  html: string
  text: string
} {
  if (htmlByteLength(html) > DOMAIN_MAIL_HTML_MAX_BYTES) {
    throw createError({ statusCode: 400, statusMessage: 'HTML 模板不能超过 512 KiB' })
  }
  const values = defaultDomainMailTemplateData()
  let rendered = html
  for (const key of Object.keys(values) as Array<keyof DomainMailTemplateData>) {
    const value = String(input[key] ?? values[key] ?? '')
    const output = key === 'body' ? escapeHtml(value).replace(/\r?\n/g, '<br>') : escapeHtml(value)
    rendered = rendered.replaceAll(`{{${key}}}`, output)
  }
  if (htmlByteLength(rendered) > DOMAIN_MAIL_HTML_MAX_BYTES) {
    throw createError({ statusCode: 400, statusMessage: '渲染后的 HTML 正文不能超过 512 KiB' })
  }
  return { html: rendered, text: stripTags(rendered) }
}

export function htmlToText(html: string): string {
  return stripTags(html)
}

function normalizeCompositionHtml(value: unknown): string {
  const html = String(value ?? '')
  if (!html.trim() || htmlByteLength(html) > DOMAIN_MAIL_HTML_MAX_BYTES) {
    throw createError({ statusCode: 400, statusMessage: 'HTML 正文不能为空且不能超过 512 KiB' })
  }
  return html
}

/** Build the exact HTML body shared by preview and delivery. */
export async function renderDomainMailComposition(input: DomainMailCompositionInput): Promise<{
  html: string
  text: string
}> {
  const mode = input?.mode === 'template' || input?.mode === 'source' ? input.mode : null
  if (!mode) throw createError({ statusCode: 400, statusMessage: '邮件正文模式不正确' })

  if (mode === 'template') {
    const source = await readDomainMailTemplate()
    const fields = input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields)
      ? input.fields as Partial<DomainMailTemplateData>
      : {}
    return renderDomainMailTemplate(source, fields)
  }

  const html = normalizeCompositionHtml(input.html)
  return { html, text: htmlToText(html) }
}
