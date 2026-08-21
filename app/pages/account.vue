<script setup lang="ts">
import { ref, onMounted } from 'vue'

useHead({ title: '账户' })

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const updating = ref(false)

const entryInput = ref('')
const currentEntry = ref('')
const savingEntry = ref(false)

const { showToast } = useToast()
const { entry: entryState, load: loadEntry } = useEntry()

onMounted(async () => {
  currentEntry.value = await loadEntry()
  entryInput.value = currentEntry.value
})

function onInput(field: 'old' | 'new' | 'confirm', e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (field === 'old') oldPassword.value = v
  else if (field === 'new') newPassword.value = v
  else confirmPassword.value = v
}

async function updatePassword() {
  if (updating.value) return
  if (!newPassword.value || newPassword.value !== confirmPassword.value) {
    showToast('两次输入的新密码不一致', 'error')
    return
  }
  updating.value = true
  try {
    const entry = await loadEntry()
    await $fetch('/api/auth/password', {
      method: 'POST',
      body: { oldPassword: oldPassword.value, newPassword: newPassword.value }
    })
    await navigateTo('/' + entry)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '更新失败', 'error')
  } finally {
    updating.value = false
  }
}

async function saveEntry() {
  if (savingEntry.value) return
  const val = entryInput.value.trim().replace(/^\/+|\/+$/g, '')
  if (!val) {
    showToast('入口不能为空', 'error')
    return
  }
  savingEntry.value = true
  try {
    const res = await $fetch<{ entry: string }>('/api/auth/entry', {
      method: 'POST',
      body: { entry: val }
    })
    currentEntry.value = res.entry
    entryInput.value = res.entry
    entryState.value = res.entry
    showToast(`安全入口已更新为 /${res.entry}`)
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '保存失败', 'error')
  } finally {
    savingEntry.value = false
  }
}

async function logout() {
  const entry = await loadEntry()
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
  } finally {
    await navigateTo('/' + entry)
  }
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">账户</h1>

    <div class="account-stack">
    <section class="card account-card">
      <h2 class="card-title">更新密码</h2>
      <div class="form">
        <md-outlined-text-field
          type="password"
          label="当前密码"
          :value="oldPassword"
          @input="onInput('old', $event)"
        ></md-outlined-text-field>
        <md-outlined-text-field
          type="password"
          label="新密码"
          :value="newPassword"
          @input="onInput('new', $event)"
        ></md-outlined-text-field>
        <md-outlined-text-field
          type="password"
          label="确认新密码"
          :value="confirmPassword"
          @input="onInput('confirm', $event)"
        ></md-outlined-text-field>
        <md-filled-button :disabled="updating" @click="updatePassword">
          {{ updating ? '更新中…' : '更新密码' }}
        </md-filled-button>
      </div>
    </section>

    <section class="card account-card">
      <h2 class="card-title">安全入口</h2>
      <p class="entry-hint">登录页只能通过该入口访问。当前入口：<code class="entry-code">/{{ currentEntry || '…' }}</code></p>
      <div class="form">
        <md-outlined-text-field
          label="安全入口"
          :value="entryInput"
          @input="entryInput = ($event.target as HTMLInputElement).value"
        ></md-outlined-text-field>
        <md-filled-button :disabled="savingEntry" @click="saveEntry">
          {{ savingEntry ? '保存中…' : '保存入口' }}
        </md-filled-button>
      </div>
    </section>

    <section class="card account-card">
      <h2 class="card-title">账户操作</h2>
      <md-text-button class="logout-btn" @click="logout">
        <md-icon slot="icon">logout</md-icon>
        登出账户
      </md-text-button>
    </section>
    </div>
  </div>
</template>

<style scoped>
.account-stack {
  width: min(100%, 520px);
  display: grid;
  gap: 20px;
}

.account-card {
  min-width: 0;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.logout-btn {
  color: var(--md-sys-color-error);
}

.entry-hint {
  margin: 0 0 16px;
  font-size: 14px;
  color: var(--md-sys-color-on-surface-variant);
}

.entry-code {
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  color: var(--md-sys-color-primary);
  overflow-wrap: anywhere;
}

@media (max-width: 480px) {
  .account-stack {
    gap: 12px;
  }

  .form md-filled-button {
    width: 100%;
  }
}
</style>
