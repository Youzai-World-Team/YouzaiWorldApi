<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

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
const isDesktop = ref(false)
const wordWrapEnabled = ref(true)
const editorFullscreen = ref(false)
const editorHost = ref<HTMLElement | null>(null)
const emailTemplateTabs = ref<HTMLElement | null>(null)
let editorInstance: any = null
let monacoLoadPromise: Promise<any> | null = null
let editorMediaQuery: MediaQueryList | null = null
let syncingEditor = false
let editorLoadErrorShown = false
let previousBodyOverflow = ''
let previewRequestId = 0
let previewTimer: ReturnType<typeof setTimeout> | null = null
const { showToast } = useToast()
const access = useAdminAccess()
const canEdit = computed(() => access.levelForKey('game-accounts') === 'edit'
  && access.featureLevelForKey('game-accounts-email-templates') === 'edit')

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

async function loadMonacoEditor() {
  if (!import.meta.client) return null
  if (!monacoLoadPromise) {
    monacoLoadPromise = (async () => {
      const globalScope = globalThis as any
      const previousDefine = globalScope.define
      globalScope.define = (_dependencies: unknown[], factory: () => unknown) => factory()
      try {
        await import('monaco-editor/min/vs/nls.messages.zh-cn.js')
      } finally {
        if (previousDefine === undefined) delete globalScope.define
        else globalScope.define = previousDefine
      }
      if (
        !Array.isArray(globalScope._VSCODE_NLS_MESSAGES)
        || globalScope._VSCODE_NLS_LANGUAGE !== 'zh-cn'
      ) {
        throw new Error('Monaco Editor 简体中文语言包加载失败')
      }

      // Monaco's ESM build needs explicit worker constructors in Vite/Nuxt.
      const [{ default: EditorWorker }, { default: HtmlWorker }] = await Promise.all([
        import('monaco-editor/esm/vs/editor/editor.worker.js?worker'),
        import('monaco-editor/esm/vs/language/html/html.worker.js?worker'),
      ])
      const environment = globalScope.MonacoEnvironment || {}
      globalScope.MonacoEnvironment = {
        ...environment,
        getWorker(_workerId: string, label: string) {
          return ['html', 'handlebars', 'razor'].includes(label)
            ? new HtmlWorker()
            : new EditorWorker()
        },
      }
      return import('monaco-editor/esm/vs/editor/editor.main.js')
    })()
  }

  try {
    const monaco = await monacoLoadPromise
    if (!monaco) return
    editorLoadErrorShown = false
    return monaco
  } catch (error) {
    monacoLoadPromise = null
    throw error
  }
}

async function createMonacoEditor() {
  const host = editorHost.value
  if (!isDesktop.value || !canEdit.value || !host || editorInstance) return

  let monaco: any
  try {
    monaco = await loadMonacoEditor()
  } catch (error) {
    console.error('Monaco Editor 加载失败', error)
    if (!editorLoadErrorShown) {
      editorLoadErrorShown = true
      showToast('HTML 源码编辑器加载失败，请刷新页面重试', 'error')
    }
    return
  }

  if (!monaco) return
  if (!isDesktop.value || !canEdit.value || editorHost.value !== host || !host.isConnected || editorInstance) return
  editorInstance = monaco.editor.create(host, {
    value: currentTemplate().html,
    language: 'html',
    theme: document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs',
    automaticLayout: true,
    minimap: { enabled: true },
    fontSize: 13,
    lineHeight: 21,
    tabSize: 2,
    wordWrap: wordWrapEnabled.value ? 'on' : 'off',
    scrollBeyondLastLine: false,
    padding: { top: 14, bottom: 14 },
  })
  editorInstance.onDidChangeModelContent(() => {
    if (syncingEditor) return
    currentTemplate().html = editorInstance.getValue()
    refreshPreview()
  })
}

function onWordWrapChange(event: Event) {
  wordWrapEnabled.value = (event.target as any).checked
  editorInstance?.updateOptions({ wordWrap: wordWrapEnabled.value ? 'on' : 'off' })
}

function setEditorFullscreen(value: boolean) {
  const nextValue = Boolean(value && isDesktop.value)
  if (nextValue === editorFullscreen.value) return
  if (nextValue) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = previousBodyOverflow
    previousBodyOverflow = ''
  }
  editorFullscreen.value = nextValue
  void nextTick(() => editorInstance?.layout())
}

function toggleEditorFullscreen() {
  setEditorFullscreen(!editorFullscreen.value)
}

function onEditorKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && editorFullscreen.value) {
    event.preventDefault()
    setEditorFullscreen(false)
  }
}

function disposeMonacoEditor() {
  const model = editorInstance?.getModel()
  editorInstance?.dispose()
  model?.dispose()
  editorInstance = null
}

function syncMonacoEditor() {
  if (!editorInstance) return
  syncingEditor = true
  editorInstance.setValue(currentTemplate().html)
  syncingEditor = false
}

function updateDesktopMode() {
  isDesktop.value = editorMediaQuery?.matches ?? false
  if (!isDesktop.value || !canEdit.value) {
    setEditorFullscreen(false)
    disposeMonacoEditor()
    return
  }
  void nextTick(createMonacoEditor)
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
    if (isDesktop.value && canEdit.value) {
      await nextTick()
      await createMonacoEditor()
    }
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
  syncMonacoEditor()
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
    syncMonacoEditor()
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
  syncMonacoEditor()
  refreshPreview()
}

onMounted(() => {
  window.addEventListener('keydown', onEditorKeydown)
  editorMediaQuery = window.matchMedia('(min-width: 901px)')
  editorMediaQuery.addEventListener('change', updateDesktopMode)
  updateDesktopMode()
  void loadSettings()
})

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer)
  window.removeEventListener('keydown', onEditorKeydown)
  setEditorFullscreen(false)
  editorMediaQuery?.removeEventListener('change', updateDesktopMode)
  disposeMonacoEditor()
})
</script>

<template>
  <div class="page email-template-page api-redesign-page">
    <div class="page-heading">
      <div class="title-row">
        <md-icon-button aria-label="返回游戏账户" title="返回游戏账户" @click="navigateTo('/game-accounts')"><md-icon>arrow_back</md-icon></md-icon-button>
        <h1 class="page-title">验证码邮件模板</h1>
      </div>
      <div class="heading-actions">
        <md-text-button v-if="canEdit" :disabled="loading || saving || !isDesktop" @click="resetCurrentTemplate">撤销当前修改</md-text-button>
        <md-filled-button v-if="canEdit" :disabled="loading || saving || !isDesktop" @click="saveTemplates">
          <md-icon slot="icon">save</md-icon>
          {{ saving ? '保存中…' : '保存模板' }}
        </md-filled-button>
      </div>
    </div>

    <div v-if="loading" class="template-loading">加载邮件模板中…</div>
    <template v-else>
      <div ref="emailTemplateTabs" class="email-template-tabs" role="tablist" aria-label="验证码邮件类型">
        <md-text-button
          v-for="item in EMAIL_TEMPLATE_KINDS"
          :key="item.key"
          :class="{ 'email-template-tab--active': activeEmailTemplate === item.key }"
          @click="selectTemplate(item.key)"
        >{{ item.label }}</md-text-button>
      </div>
      <AppScrollbar :target="emailTemplateTabs" axis="horizontal" label="邮件模板类型横向滚动条" />

      <div class="template-meta">
        <label>
          <span>邮件主题</span>
          <input :value="currentTemplate().subject" maxlength="200" :disabled="!isDesktop || !canEdit" @input="onSubjectInput">
        </label>
          <p>占位符：<code v-pre>{{username}}</code>、<code v-pre>{{code}}</code>、<code v-pre>{{subject}}</code>、<code v-pre>{{logoUrl}}</code></p>
      </div>

      <div v-if="!isDesktop || !canEdit" class="mobile-preview-notice">
        <md-icon>desktop_windows</md-icon>
        <span>{{ !canEdit ? '当前账户只有查看权限，仅可预览邮件。' : '手机版仅支持预览，请使用电脑编辑邮件 HTML 源码。' }}</span>
      </div>

      <div class="email-template-workspace">
        <section
          v-if="isDesktop && canEdit"
          class="template-source-panel"
          :class="{ 'template-source-panel--fullscreen': editorFullscreen }"
        >
          <div class="panel-heading">
            <h2>HTML 源码</h2>
            <div class="editor-panel-actions">
              <label class="word-wrap-option">
                <md-checkbox :checked="wordWrapEnabled" @change="onWordWrapChange"></md-checkbox>
                <span>自动换行</span>
              </label>
              <span class="source-status">{{ currentTemplate().html.length.toLocaleString() }} 字符</span>
              <md-filled-button
                v-if="editorFullscreen"
                :disabled="saving"
                @click="saveTemplates"
              >
                <md-icon slot="icon">save</md-icon>
                {{ saving ? '保存中…' : '保存模板' }}
              </md-filled-button>
              <md-icon-button
                :aria-label="editorFullscreen ? '退出全屏编辑' : '全屏编辑'"
                :title="editorFullscreen ? '退出全屏编辑' : '全屏编辑'"
                @click="toggleEditorFullscreen"
              >
                <md-icon>{{ editorFullscreen ? 'fullscreen_exit' : 'fullscreen' }}</md-icon>
              </md-icon-button>
            </div>
          </div>
          <div ref="editorHost" class="html-source-editor" aria-label="邮件 HTML 源码"></div>
        </section>

        <section class="template-preview-panel" :class="{ 'template-preview-panel--mobile': !isDesktop }">
          <div class="panel-heading">
            <h2>实时预览</h2>
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
  width: min(100%, 1600px);
}

.page-heading {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.heading-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.title-row .page-title {
  margin: 0;
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
  overflow-x: auto;
  overscroll-behavior-x: contain;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.email-template-tabs md-text-button {
  flex: 0 0 auto;
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

.mobile-preview-notice {
  display: none;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px;
  padding: 12px 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 8px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
}

.email-template-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  min-height: min(720px, calc(100vh - 280px));
  min-height: min(720px, calc(100dvh - 280px));
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

.editor-panel-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.word-wrap-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
  white-space: nowrap;
}

.editor-panel-actions md-filled-button {
  white-space: nowrap;
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
  background: #1e1e1e;
}

.template-source-panel--fullscreen {
  position: fixed;
  z-index: 50;
  inset: 0;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  border: 0;
  border-radius: 0;
}

.template-source-panel--fullscreen .html-source-editor {
  min-height: 0;
}

.template-preview-panel iframe {
  flex: 1;
  width: 100%;
  min-height: 580px;
  border: 0;
  background: #f3fbf7;
}

@media (max-width: 1200px) {
  .email-template-workspace {
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
  }
}

@media (max-width: 900px) {
  .page-heading,
  .template-meta {
    align-items: stretch;
    flex-direction: column;
  }

  .heading-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .heading-actions md-filled-button,
  .heading-actions md-text-button {
    flex: 1;
  }

  .editor-panel-actions {
    display: none;
  }

  .mobile-preview-notice {
    display: flex;
  }

  .template-preview-panel--mobile {
    min-height: calc(100vh - 330px);
    min-height: calc(100dvh - 330px);
  }

  .html-source-editor,
  .template-preview-panel iframe {
    min-height: 480px;
  }
}
</style>
