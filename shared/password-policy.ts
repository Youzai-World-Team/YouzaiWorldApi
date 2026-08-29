export const PASSWORD_STRENGTH_LABELS = ['未输入', '基础', '一般', '中等', '良好', '强', '严格'] as const

export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type PasswordPolicyMinimumScore = 1 | 2 | 3 | 4 | 5 | 6

export interface PasswordPolicy {
  enabled: boolean
  minimumScore: PasswordPolicyMinimumScore
}

export interface PasswordExpiryPolicy {
  enabled: boolean
  days: number
}

export interface PasswordExpiryStatus {
  enabled: boolean
  passwordChangedAt: number
  expiresAt: number | null
  daysRemaining: number | null
  warning: boolean
  expired: boolean
}

export interface PasswordRequirementStatus {
  key: 'length' | 'letter' | 'lowercase' | 'uppercase' | 'number' | 'symbol' | 'sequence' | 'unique' | 'repeat'
  label: string
  met: boolean
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  enabled: false,
  minimumScore: 3,
}

export const PASSWORD_EXPIRY_WARNING_DAYS = 10
export const MIN_PASSWORD_EXPIRY_DAYS = 1
export const MAX_PASSWORD_EXPIRY_DAYS = 3650
export const DEFAULT_PASSWORD_EXPIRY_POLICY: PasswordExpiryPolicy = {
  enabled: false,
  days: 90,
}

const DAY_MS = 24 * 60 * 60 * 1000

export function normalizePasswordPolicyMinimumScore(value: unknown): PasswordPolicyMinimumScore {
  const score = Math.round(Number(value))
  if (!Number.isFinite(score)) return DEFAULT_PASSWORD_POLICY.minimumScore
  if (score <= 1) return 1
  if (score >= 6) return 6
  return score as PasswordPolicyMinimumScore
}

export function normalizePasswordPolicy(value: Partial<PasswordPolicy> | null | undefined): PasswordPolicy {
  return {
    enabled: value?.enabled === true,
    minimumScore: normalizePasswordPolicyMinimumScore(value?.minimumScore),
  }
}

export function normalizePasswordExpiryDays(value: unknown): number {
  const days = Math.round(Number(value))
  if (!Number.isFinite(days)) return DEFAULT_PASSWORD_EXPIRY_POLICY.days
  return Math.min(MAX_PASSWORD_EXPIRY_DAYS, Math.max(MIN_PASSWORD_EXPIRY_DAYS, days))
}

export function normalizePasswordExpiryPolicy(
  value: Partial<PasswordExpiryPolicy> | null | undefined,
): PasswordExpiryPolicy {
  return {
    enabled: value?.enabled === true,
    days: normalizePasswordExpiryDays(value?.days),
  }
}

export function calculatePasswordExpiryStatus(
  policy: PasswordExpiryPolicy,
  passwordChangedAtValue: unknown,
  now = Date.now(),
): PasswordExpiryStatus {
  const rawChangedAt = Number(passwordChangedAtValue)
  const passwordChangedAt = Number.isFinite(rawChangedAt) && rawChangedAt > 0
    ? Math.trunc(rawChangedAt)
    : now
  if (!policy.enabled) {
    return {
      enabled: false,
      passwordChangedAt,
      expiresAt: null,
      daysRemaining: null,
      warning: false,
      expired: false,
    }
  }
  const expiresAt = passwordChangedAt + normalizePasswordExpiryDays(policy.days) * DAY_MS
  const remainingMs = expiresAt - now
  const expired = remainingMs <= 0
  return {
    enabled: true,
    passwordChangedAt,
    expiresAt,
    daysRemaining: expired ? 0 : Math.ceil(remainingMs / DAY_MS),
    warning: !expired && remainingMs <= PASSWORD_EXPIRY_WARNING_DAYS * DAY_MS,
    expired,
  }
}

export function passwordStrengthLabel(score: PasswordStrengthScore): string {
  return PASSWORD_STRENGTH_LABELS[score]
}

export function passwordPolicyMinimumLength(score: PasswordPolicyMinimumScore, minLength: number): number {
  if (score >= 6) return Math.max(minLength, 16)
  if (score >= 5) return Math.max(minLength, 14)
  return minLength
}

function containsSequentialLetterOrNumberRun(password: string): boolean {
  const characters = Array.from(password.toLowerCase())
  for (let index = 0; index <= characters.length - 3; index += 1) {
    const codes = characters.slice(index, index + 3).map(character => character.codePointAt(0) ?? -1)
    const allDigits = codes.every(code => code >= 48 && code <= 57)
    const allLetters = codes.every(code => code >= 97 && code <= 122)
    if (!allDigits && !allLetters) continue
    const firstStep = codes[1]! - codes[0]!
    const secondStep = codes[2]! - codes[1]!
    if ((firstStep === 1 || firstStep === -1) && secondStep === firstStep) return true
  }
  return false
}

export function passwordPolicyRequirements(
  password: string,
  minLength: number,
  score: PasswordPolicyMinimumScore,
): PasswordRequirementStatus[] {
  const length = Array.from(password).length
  const requiredLength = passwordPolicyMinimumLength(score, minLength)
  const requirements: PasswordRequirementStatus[] = [
    { key: 'length', label: `至少 ${requiredLength} 位`, met: length >= requiredLength },
  ]

  if (score === 1) return requirements

  if (score === 2) {
    requirements.push(
      { key: 'letter', label: '包含字母', met: /\p{L}/u.test(password) },
      { key: 'number', label: '包含数字', met: /\p{N}/u.test(password) },
    )
    return requirements
  }

  requirements.push(
    { key: 'lowercase', label: '包含小写字母', met: /\p{Ll}/u.test(password) },
    { key: 'uppercase', label: '包含大写字母', met: /\p{Lu}/u.test(password) },
    { key: 'number', label: '包含数字', met: /\p{N}/u.test(password) },
  )
  if (score >= 4) {
    requirements.push({
      key: 'symbol',
      label: '包含特殊字符',
      met: /[^\p{L}\p{N}\s]/u.test(password),
    })
  }
  if (score >= 5) {
    requirements.push({
      key: 'sequence',
      label: '不得出现数字或字母连号',
      met: !containsSequentialLetterOrNumberRun(password),
    })
  }
  if (score >= 6) {
    requirements.push(
      {
        key: 'unique',
        label: '包含至少 10 个不同字符',
        met: new Set(Array.from(password)).size >= 10,
      },
      {
        key: 'repeat',
        label: '不连续出现 3 个相同字符',
        met: !/(.)\1{2}/u.test(password),
      },
    )
  }
  return requirements
}

export function passwordPolicyRequirementLabels(
  score: PasswordPolicyMinimumScore,
  minLength: number,
): string[] {
  return passwordPolicyRequirements('', minLength, score).map((requirement) => requirement.label)
}

export function calculatePasswordStrength(password: string, minLength: number): PasswordStrengthScore {
  if (!password) return 0
  for (const score of [6, 5, 4, 3, 2, 1] as const) {
    if (passwordPolicyRequirements(password, minLength, score).every((requirement) => requirement.met)) {
      return score
    }
  }
  return 1
}

export function passwordMeetsPolicy(password: string, minLength: number, policy: PasswordPolicy): boolean {
  return !policy.enabled
    || passwordPolicyRequirements(password, minLength, policy.minimumScore).every((requirement) => requirement.met)
}
