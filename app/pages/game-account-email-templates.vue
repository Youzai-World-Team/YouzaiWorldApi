<script setup lang="ts">
import { onMounted, ref } from 'vue'

useHead({ title: '验证码邮件模板' })

type EmailTemplateKind = 'registration' | 'password-reset' | 'email-change'
interface EmailTemplate {
  subject: string
  html: string
}
interface GameAccountSettings {
  emailTemplates: Record<EmailTemplateKind, EmailTemplate>
}

const EMAIL_TEMPLATE_KINDS: Array<{ key: EmailTemplateKind; label: string }> = [
  { key: 'registration', label: '注册验证' },
  { key: 'password-reset', label: '找回密码' },
  { key: 'email-change', label: '换绑邮箱' },
]

const emptyTemplates = (): Record<EmailTemplateKind, EmailTemplate> => ({
  registration: { subject: '', html: '' },
  'password-reset': { subject: '', html: '' },
  'email-change': { subject: '', html: '' },
})

const settings = ref<GameAccountSettings>({ emailTemplates: emptyTemplates() })
const drafts = ref<Record<EmailTemplateKind, EmailTemplate>>(emptyTemplates())
const activeEmailTemplate = ref<EmailTemplateKind>('registration')
const previewHtml = ref('')
const loading = ref(true)
const saving = ref(false)
const previewing = ref(false)
let previewRequestId = 0
let previewTimer: ReturnType<typeof setTimeout> | null = null
const { showToast } = useToast()

function cloneTemplates(value: Record<EmailTemplateKind, EmailTemplate>) {
  return Object.fromEntries(EMAIL_TEMPLATE_KINDS.map(({ key }) => [
    key,
    { subject: value[key]?.subject || '', html: value[key]?.html || '' },
  ])) as Record<EmailTemplateKind, EmailTemplate>
}

function currentTemplate() {
  return drafts.value[activeEmailTemplate.value]
}

function onSubjectInput(event: Event) {
  currentTemplate().subject = (event.target as HTMLInputElement).value
  refreshPreview()
}

function onHtmlInput(event: Event) {
  currentTemplate().html = (event.target as HTMLTextAreaElement).value
  refreshPreview()
}

async function loadSettings() {
  loading.value = true
  try {
    const result = await $fetch<GameAccountSettings>('/api/admin/game-account-settings')
    settings.value = result
    drafts.value = cloneTemplates(result.emailTemplates)
    refreshPreview()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || '邮件模板加载失败', 'error')
  } finally {
    loading.value = false
  }
}

function refreshPreview() {
  if (previewTimer) clearTimeout(previewTimer)
  const requestId = ++previewRequestId
  previewTimer = setTimeout(() => {
    previewTimer = null
    void requestPreview(requestId)
  }, 140)
}

async function requestPreview(requestId: number) {
  const kind = activeEmailTemplate.value
  const template = currentTemplate()
  if (!template) return
  previewing.value = true
  try {
    const html = await $fetch<string>('/api/admin/game-account-email-preview', {
      method: 'POST',
      body: {
        type: kind,
        template: {
          ...template,
          subject: template.subject.trim() || '邮件预览',
        },
      },
      responseType: 'text',
    })
    if (requestId === previewRequestId) previewHtml.value = html
  } catch (e: any) {
    if (requestId === previewRequestId) {
      previewHtml.value = ''
      showToast(e?.data?.statusMessage || '邮件预览生成失败', 'error')
    }
  } finally {
    if (requestId === previewRequestId) previewing.value = false
  }
}

function selectTemplate(kind: EmailTemplateKind) {
  activeEmailTemplate.value = kind
  refreshPreview()
}

async function saveTemplates() {
  saving.value = true
  try {
    const result = await $fetch<GameAccountSettings>('/api/admin/game-account-settings', {
      method: 'PATCH',
      body: { emailTemplates: drafts.value },
    })
    settings.value = result
    drafts.value = cloneTemplates(result.emailTemplates)
    showToast('验证码邮件模板已保存')
    refreshPreview()
  } catch (e: any) {
    showToast(e?.data?.message || e?.data?.statusMessage || '邮件模板保存失败', 'error')
  } finally {
    saving.value = false
  }
}

function resetCurrentTemplate() {
  const saved = settings.value.emailTemplates[activeEmailTemplate.value]
  drafts.value[activeEmailTemplate.value] = {
    subject: saved.subject,
    html: saved.html,
  }
  void refreshPreview()
}

onMounted(() => {
  void loadSettings()
})
</script>

<template>
  <div class="page email-template-page">
    <div class="page-heading">
      <div class="title-row">
        <md-icon-button aria-label="返回游戏账户" @click="navigateTo('/game-accounts')"><md-icon>arrow_back</md-icon></md-icon-button>
        <div>
          <h1 class="page-title">验证码邮件模板</h1>
          <p class="page-subtitle">直接编辑邮件 HTML 源码，保存后将用于实际发信。</p>
        </div>
      </div>
      <div class="heading-actions">
        <md-text-button :disabled="loading || saving" @click="resetCurrentTemplate">撤销当前修改</md-text-button>
        <md-filled-button :disabled="loading || saving" @click="saveTemplates">
          <md-icon slot="icon">save</md-icon>
          {{ saving ? '保存中…' : '保存模板' }}
        </md-filled-button>
      </div>
    </div>

    <div v-if="loading" class="template-loading">加载邮件模板中…</div>
    <template v-else>
      <div class="email-template-tabs" role="tablist" aria-label="验证码邮件类型">
        <md-text-button
          v-for="item in EMAIL_TEMPLATE_KINDS"
          :key="item.key"
          :class="{ 'email-template-tab--active': activeEmailTemplate === item.key }"
          @click="selectTemplate(item.key)"
        >{{ item.label }}</md-text-button>
      </div>

      <div class="template-meta">
        <label>
          <span>邮件主题</span>
          <input :value="currentTemplate().subject" maxlength="200" @input="onSubjectInput">
        </label>
          <p>源码占位符：<code v-pre>{{username}}</code>、<code v-pre>{{code}}</code>、<code v-pre>{{subject}}</code>、<code v-pre>{{logoUrl}}</code>。预览名称使用当前后台账户全名。</p>
      </div>

      <div class="email-template-workspace">
        <section class="template-source-panel">
          <div class="panel-heading">
            <div>
              <h2>HTML 源码</h2>
              <span>支持完整 HTML 文档和内联样式</span>
            </div>
            <span class="source-status">{{ currentTemplate().html.length.toLocaleString() }} 字符</span>
          </div>
          <textarea
            :value="currentTemplate().html"
            class="html-source-editor"
            spellcheck="false"
            aria-label="邮件 HTML 源码"
            @input="onHtmlInput"
          ></textarea>
        </section>

        <section class="template-preview-panel">
          <div class="panel-heading">
            <div>
              <h2>实时预览</h2>
              <span>预览使用当前后台账户名称和验证码 123456</span>
            </div>
            <span v-if="previewing" class="source-status">更新中…</span>
          </div>
          <iframe title="验证码邮件实时预览" sandbox="" :srcdoc="previewHtml"></iframe>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.email-template-page {
  max-width: 1600px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.title-row .page-title {
  margin-bottom: 4px;
}

.page-subtitle {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
}

.template-loading {
  padding: 64px 20px;
  text-align: center;
  color: var(--md-sys-color-on-surface-variant);
}

.email-template-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.email-template-tab--active {
  color: var(--md-sys-color-primary);
  font-weight: 600;
}

.template-meta {
  display: flex;
  align-items: end;
  gap: 16px;
  margin-bottom: 16px;
}

.template-meta label {
  display: grid;
  gap: 6px;
  width: min(560px, 100%);
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
}

.template-meta input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--md-sys-color-surface);
  color: var(--md-sys-color-on-surface);
  font: inherit;
}

.template-meta p {
  margin: 0 0 10px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}

.template-meta code {
  padding: 2px 4px;
  border-radius: 4px;
  background: var(--md-sys-color-surface-container-high);
}

.email-template-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  min-height: min(720px, calc(100vh - 280px));
}

.template-source-panel,
.template-preview-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 8px;
  background: var(--md-sys-color-surface);
}

.panel-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.panel-heading h2 {
  margin: 0 0 3px;
  font-size: 15px;
}

.panel-heading span {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}

.source-status {
  flex: 0 0 auto;
  white-space: nowrap;
}

.html-source-editor {
  flex: 1;
  width: 100%;
  min-height: 580px;
  box-sizing: border-box;
  border: 0;
  border-radius: 0;
  padding: 16px;
  outline: 0;
  resize: none;
  background: #18221f;
  color: #d8eee4;
  font: 13px/1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  tab-size: 2;
}

.template-preview-panel iframe {
  flex: 1;
  width: 100%;
  min-height: 580px;
  border: 0;
  background: #f3fbf7;
}

@media (max-width: 900px) {
  .page-heading,
  .template-meta {
    align-items: stretch;
    flex-direction: column;
  }

  .heading-actions {
    width: 100%;
  }

  .heading-actions md-filled-button,
  .heading-actions md-text-button {
    flex: 1;
  }

  .email-template-workspace {
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
  }

  .html-source-editor,
  .template-preview-panel iframe {
    min-height: 480px;
  }
}
</style>
