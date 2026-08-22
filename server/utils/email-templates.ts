export type VerificationEmailTemplateKind = 'registration' | 'password-reset' | 'email-change'

export const VERIFICATION_EMAIL_TEMPLATE_KINDS: VerificationEmailTemplateKind[] = [
  'registration',
  'password-reset',
  'email-change',
]

export interface VerificationEmailTemplate {
  subject: string
  heading: string
  intro: string
  expiryNotice: string
  details: string[]
  html: string
}

export type VerificationEmailTemplates = Record<VerificationEmailTemplateKind, VerificationEmailTemplate>

export const DEFAULT_VERIFICATION_EMAIL_TEMPLATES: VerificationEmailTemplates = {
  registration: {
    subject: '悠哉世界游戏账户邮箱验证码',
    heading: '账户邮箱验证码',
    intro: '你正在为游戏账户验证邮箱。',
    expiryNotice: '验证码 10 分钟内有效，请勿将验证码透露给任何人。',
    details: ['如果这不是你的操作，请忽略此邮件。'],
    html: '',
  },
  'password-reset': {
    subject: '悠哉世界游戏账户找回密码验证码',
    heading: '账户找回密码验证码',
    intro: '你正在为游戏账户找回密码。',
    expiryNotice: '验证码 10 分钟内有效，请勿将验证码透露给任何人。',
    details: ['如果这不是你的操作，请忽略此邮件并保护好账户安全。'],
    html: '',
  },
  'email-change': {
    subject: '悠哉世界游戏账户换绑邮箱验证码',
    heading: '账户换绑邮箱验证码',
    intro: '你正在为游戏账户换绑邮箱。',
    expiryNotice: '验证码 10 分钟内有效，请勿将验证码透露给任何人。',
    details: [
      '验证成功后，该邮箱将成为账户的新绑定邮箱。',
      '如果这不是你的操作，请忽略此邮件并立即修改账户密码。',
    ],
    html: '',
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validateText(value: unknown, fallback: string, maxLength: number): string {
  const text = value === undefined ? fallback : String(value).trim()
  if (!text || text.length > maxLength || /[\r\n]/.test(text)) throw new Error('邮件模板文本格式不正确')
  return text
}

export function resolveVerificationEmailTemplate(
  value: unknown,
  fallback: VerificationEmailTemplate,
): VerificationEmailTemplate {
  const source = isRecord(value) ? value : {}
  const detailsValue = source.details
  const details = detailsValue === undefined
    ? fallback.details
    : Array.isArray(detailsValue)
      ? detailsValue.map((detail) => validateText(detail, '', 500))
      : String(detailsValue).split(/\r?\n/).map((detail) => detail.trim()).filter(Boolean).map((detail) => validateText(detail, '', 500))
  if (details.length > 4) throw new Error('邮件模板补充说明过多')

  return {
    subject: validateText(source.subject, fallback.subject, 200),
    heading: validateText(source.heading, fallback.heading, 100),
    intro: validateText(source.intro, fallback.intro, 500),
    expiryNotice: validateText(source.expiryNotice, fallback.expiryNotice, 300),
    details,
    html: source.html === undefined
      ? fallback.html
      : (() => {
          const html = String(source.html)
          if (html.length > 300_000) throw new Error('邮件 HTML 源码过大')
          return html
        })(),
  }
}

export function cloneVerificationEmailTemplates(): VerificationEmailTemplates {
  return Object.fromEntries(
    VERIFICATION_EMAIL_TEMPLATE_KINDS.map((kind) => [
      kind,
      {
        ...DEFAULT_VERIFICATION_EMAIL_TEMPLATES[kind],
        details: [...DEFAULT_VERIFICATION_EMAIL_TEMPLATES[kind].details],
      },
    ]),
  ) as VerificationEmailTemplates
}
