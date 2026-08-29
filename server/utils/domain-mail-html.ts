import { EMAIL_PREVIEW_SCROLLBAR_CSS } from './email-preview-scrollbar'

interface SanitizedMailHtml {
  html: string
  css: string
  blockedImages?: number
  truncated?: boolean
}

const DOMAIN_MAIL_TEMPLATE_LOGO_URL = 'https://assets.mcyzw.top/images/uzw-tm.png'

function normalizedOrigin(value: string): string {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : ''
  } catch {
    return ''
  }
}

function readerContent(content: SanitizedMailHtml, origin: string): SanitizedMailHtml {
  if (!origin) return content
  return {
    ...content,
    html: content.html.replaceAll(DOMAIN_MAIL_TEMPLATE_LOGO_URL, `${origin}/api/domain-mail-logo`),
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function domainMailHtmlFileName(subject: string, id: string): string {
  const stem = subject
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 96)
  return `${stem || 'mail'}-${id.slice(0, 8)}.html`
}

export function domainMailContentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  const asciiName = filename
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["%]/g, '_')
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export function buildDomainMailReaderDocument(subject: string, content: SanitizedMailHtml, requestOrigin = ''): string {
  const origin = normalizedOrigin(requestOrigin)
  const resolvedContent = readerContent(content, origin)
  const baseCss = `
:root { color-scheme: light; }
html, body { margin: 0; min-height: 100%; background: #ffffff; }
body {
  padding: 24px;
  color: #191d14;
  font: 14px/1.65 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  overflow-wrap: anywhere;
  word-break: break-word;
}
img:not(.yzw-blocked-img) { max-width: 100%; height: auto; }
blockquote {
  margin: 8px 0;
  padding: 4px 0 4px 12px;
  border-left: 3px solid #c2c9b4;
  color: #44483b;
}
@media (max-width: 640px) { body { padding: 14px; } }
`.trim()
  const markerCss = `
.yzw-link {
  color: #1a56c4 !important;
  text-decoration: underline dotted !important;
}
.yzw-link::after { content: " \\1F517"; font-size: 11px; }
.yzw-link--blocked {
  color: #8a1c14 !important;
  text-decoration-line: line-through !important;
}
.yzw-link--blocked::after { content: " (已移除)"; font-size: 11px; }
.yzw-blocked-img {
  box-sizing: border-box !important;
  border: 1px dashed #a8b096 !important;
  background-color: #f4f6ee !important;
}
`.trim()

  const csp = `default-src 'none'; img-src data:${origin ? ` ${origin}` : ''} https://mcyzw.top https://assets.mcyzw.top https://*.mcyzw.top; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'`
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<title>${escapeHtml(subject || '邮件')}</title>`
    + `<style>${baseCss}</style>`
    + (resolvedContent.css ? `<style>${resolvedContent.css}</style>` : '')
    + `<style>${EMAIL_PREVIEW_SCROLLBAR_CSS}</style>`
    + `<style>${markerCss}</style>`
    + `</head><body>${resolvedContent.html || '<p>（无 HTML 正文）</p>'}</body></html>`
}

export function buildDomainMailSandboxDocument(subject: string, content: SanitizedMailHtml, requestOrigin = ''): string {
  const innerDocument = buildDomainMailReaderDocument(subject, content, requestOrigin)
  const notices = [
    content.blockedImages ? `已拦截 ${content.blockedImages} 张图片` : '',
    content.truncated ? '内容已截断' : '',
  ].filter(Boolean)

  const shellCss = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; }
body {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  background: #f5f7f1;
  color: #191d14;
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}
header {
  min-width: 0;
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 18px;
  border-bottom: 1px solid #d9dfcf;
  background: #ffffff;
}
.subject {
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sandbox-state {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #5d6350;
  font-size: 11px;
}
.sandbox-state span {
  padding: 3px 7px;
  border: 1px solid #c2c9b4;
  border-radius: 4px;
  background: #f4f6ee;
}
iframe {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border: 0;
  background: #ffffff;
}
@media (max-width: 640px) {
  header { min-height: 48px; padding: 8px 12px; }
  .sandbox-state span:not(:first-child) { display: none; }
}
`.trim()

  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${escapeHtml(subject || '邮件')}</title>`
    + `<style>${shellCss}</style>`
    + '</head><body><header>'
    + `<div class="subject">${escapeHtml(subject || '（无主题）')}</div>`
    + '<div class="sandbox-state"><span>严格沙箱</span>'
    + notices.map((notice) => `<span>${escapeHtml(notice)}</span>`).join('')
    + '</div></header>'
    + `<iframe sandbox="" referrerpolicy="no-referrer" title="邮件正文沙箱" srcdoc="${escapeHtml(innerDocument)}"></iframe>`
    + '</body></html>'
}
