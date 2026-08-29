<script setup lang="ts">
import { computed } from 'vue'
import {
  calculatePasswordStrength,
  passwordPolicyMinimumLength,
  passwordPolicyRequirements,
  passwordStrengthLabel,
  type PasswordPolicyMinimumScore,
} from '#shared/password-policy'

const props = withDefaults(defineProps<{
  password: string
  minLength?: number
  maxLength?: number
  requiredScore?: PasswordPolicyMinimumScore | 0
}>(), {
  minLength: 12,
  maxLength: 128,
  requiredScore: 0,
})

const passwordLength = computed(() => Array.from(props.password).length)
const strength = computed(() => calculatePasswordStrength(props.password, props.minLength))
const effectiveMinLength = computed(() => props.requiredScore
  ? passwordPolicyMinimumLength(props.requiredScore, props.minLength)
  : props.minLength)
const displayedStrength = computed(() => passwordLength.value > props.maxLength ? 1 : strength.value)
const requirement = computed(() => props.requiredScore
  ? `要求${passwordStrengthLabel(props.requiredScore)}`
  : '')
const requirements = computed(() => {
  const lengthRequirement = {
    key: 'length' as const,
    label: `长度为 ${effectiveMinLength.value} 至 ${props.maxLength} 位`,
    met: passwordLength.value >= effectiveMinLength.value && passwordLength.value <= props.maxLength,
  }
  if (!props.requiredScore) return [lengthRequirement]
  return passwordPolicyRequirements(props.password, props.minLength, props.requiredScore)
    .map(item => item.key === 'length' ? lengthRequirement : item)
})

const label = computed(() => {
  if (!props.password) return '未输入'
  if (passwordLength.value < effectiveMinLength.value) return `至少 ${effectiveMinLength.value} 位`
  if (passwordLength.value > props.maxLength) return `不超过 ${props.maxLength} 位`
  return passwordStrengthLabel(strength.value)
})
</script>

<template>
  <div class="password-strength" :class="`password-strength--${displayedStrength}`">
    <div class="password-strength-heading">
      <span>{{ requirement ? `密码强度 · ${requirement}` : '密码强度' }}</span>
      <strong aria-live="polite">{{ label }}</strong>
    </div>
    <div
      class="password-strength-meter"
      role="meter"
      aria-label="密码强度"
      aria-valuemin="0"
      aria-valuemax="6"
      :aria-valuenow="displayedStrength"
      :aria-valuetext="requirement ? `${label}，${requirement}` : label"
    >
      <span
        v-for="segment in 6"
        :key="segment"
        :class="{ 'password-strength-segment--active': segment <= displayedStrength }"
      ></span>
    </div>
    <ul v-if="requirements.length" class="password-requirements" aria-label="密码具体要求">
      <li
        v-for="item in requirements"
        :key="item.key"
        :class="{
          'password-requirement--met': item.met,
          'password-requirement--unmet': password && !item.met,
        }"
      >
        <md-icon>{{ item.met ? 'check_circle' : (password ? 'cancel' : 'radio_button_unchecked') }}</md-icon>
        <span>{{ item.label }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.password-strength {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 6px;
  margin-top: -8px;
  color: var(--md-sys-color-outline);
}

.password-strength--1 {
  color: var(--md-sys-color-error);
}

.password-strength--2 {
  color: var(--act-warning);
}

.password-strength--3 {
  color: var(--md-sys-color-secondary);
}

.password-strength--4 {
  color: var(--md-sys-color-tertiary);
}

.password-strength--5 {
  color: var(--act-success);
}

.password-strength--6 {
  color: var(--md-sys-color-primary);
}

.password-strength-heading {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  line-height: 1.4;
}

.password-strength-heading span {
  color: var(--md-sys-color-on-surface-variant);
}

.password-strength-heading strong {
  overflow: hidden;
  color: currentColor;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.password-strength-meter {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 4px;
}

.password-strength-meter > span {
  height: 4px;
  border-radius: 2px;
  background: var(--md-sys-color-surface-container-highest);
  transition: background-color 160ms ease;
}

.password-strength-meter > .password-strength-segment--active {
  background: currentColor;
}

.password-requirements {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 14px;
  margin: 2px 0 0;
  padding: 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 11px;
  line-height: 1.4;
  list-style: none;
}

.password-requirements li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.password-requirements md-icon {
  flex: 0 0 auto;
  --md-icon-size: 14px;
}

.password-requirement--met {
  color: var(--act-success);
}

.password-requirement--unmet {
  color: var(--md-sys-color-error);
}

@media (prefers-reduced-motion: reduce) {
  .password-strength-meter > span {
    transition: none;
  }
}
</style>
