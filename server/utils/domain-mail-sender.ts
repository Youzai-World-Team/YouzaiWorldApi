import { createError } from 'h3'

import { requireEmailAddress } from './game-input'

export const DOMAIN_MAIL_SENDER_DOMAIN = 'mcyzw.top'

export function requireDomainMailSenderAddress(value: unknown): string {
  const localPart = String(value ?? '').trim().toLowerCase()
  if (!localPart || localPart.length > 64 || localPart.includes('@') || /[\r\n]/.test(localPart)) {
    throw createError({ statusCode: 400, statusMessage: '发件地址格式不正确' })
  }
  return requireEmailAddress(`${localPart}@${DOMAIN_MAIL_SENDER_DOMAIN}`)
}
