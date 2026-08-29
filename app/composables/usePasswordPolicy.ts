import { readonly } from 'vue'
import {
  DEFAULT_PASSWORD_POLICY,
  normalizePasswordPolicy,
  passwordMeetsPolicy,
  passwordPolicyRequirementLabels,
  passwordStrengthLabel,
  type PasswordPolicy,
} from '#shared/password-policy'

export function usePasswordPolicy() {
  const policy = useState<PasswordPolicy>('password-policy', () => ({ ...DEFAULT_PASSWORD_POLICY }))
  const loaded = useState('password-policy-loaded', () => false)
  const loading = useState('password-policy-loading', () => false)

  function apply(value: Partial<PasswordPolicy>) {
    policy.value = normalizePasswordPolicy(value)
    loaded.value = true
  }

  async function load(force = false): Promise<PasswordPolicy> {
    if (loaded.value && !force) return policy.value
    if (loading.value) return policy.value
    loading.value = true
    try {
      const result = await $fetch<PasswordPolicy>('/api/auth/password-policy')
      apply(result)
    } catch {
      // 提交时服务端仍会执行最新策略；读取失败不应阻断表单加载。
    } finally {
      loading.value = false
    }
    return policy.value
  }

  function validate(password: string, minLength: number, label = '密码'): string | null {
    if (passwordMeetsPolicy(password, minLength, policy.value)) return null
    const requirements = passwordPolicyRequirementLabels(policy.value.minimumScore, minLength).join('、')
    return `${label}复杂度需要达到“${passwordStrengthLabel(policy.value.minimumScore)}”：${requirements}`
  }

  return {
    policy: readonly(policy),
    loading: readonly(loading),
    load,
    apply,
    validate,
  }
}
