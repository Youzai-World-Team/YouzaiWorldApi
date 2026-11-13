<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  CORE_ANNOUNCEMENT_MAX_BODY_LENGTH,
  CORE_ANNOUNCEMENT_MAX_BODY_LINES,
  CORE_ANNOUNCEMENT_MAX_LINE_LENGTH,
  CORE_ANNOUNCEMENT_MAX_SUBTITLE_LENGTH,
  CORE_ANNOUNCEMENT_MAX_TITLE_LENGTH,
  validateCoreAnnouncementContent,
  type CoreAnnouncement,
  type CoreAnnouncementContent,
} from '#shared/core-announcement'

useHead({ title: 'Core 公告' })

const ENDPOINT = '/api/admin/core-announcement'
const access = useAdminAccess()
const { showToast } = useToast()
const canEdit = computed(() => access.levelForKey('core-announcement') === 'edit')
const saved = ref<CoreAnnouncement | null>(null)
const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const enabled = ref(false)
const title = ref('')
const subtitle = ref('')
const bodyText = ref('')
const bodyLines = computed(() => bodyText.value.replace(/\r\n?/g, '\n').split('\n'))
const content = computed(() => ({ enabled: enabled.value, title: title.value, subtitle: subtitle.value, body: bodyLines.value }))
const dirty = computed(() => saved.value !== null && JSON.stringify(content.value) !== JSON.stringify({
  enabled: saved.value.enabled, title: saved.value.title, subtitle: saved.value.subtitle, body: saved.value.body,
}))
const locked = computed(() => !canEdit.value || !saved.value || loading.value || saving.value)
const validationMessage = computed(() => {
  if (!saved.value) return ''
  try {
    validateCoreAnnouncementContent(content.value)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : '公告内容格式不正确'
  }
})
const updatedAtLabel = computed(() => saved.value?.updatedAt
  ? new Date(saved.value.updatedAt).toLocaleString('zh-CN') : '尚未保存')

function restoreSaved() {
  if (!saved.value) return
  enabled.value = saved.value.enabled
  title.value = saved.value.title
  subtitle.value = saved.value.subtitle
  bodyText.value = saved.value.body.join('\n')
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    saved.value = await $fetch<CoreAnnouncement>(ENDPOINT)
    restoreSaved()
  } catch (error: any) {
    loadError.value = error?.data?.statusMessage || '公告加载失败，请重试'
  } finally {
    loading.value = false
  }
}

async function save() {
  if (locked.value || !dirty.value) return
  let payload: CoreAnnouncementContent
  try {
    payload = validateCoreAnnouncementContent(content.value)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '公告内容格式不正确', 'error')
    return
  }
  saving.value = true
  try {
    saved.value = await $fetch<CoreAnnouncement>(ENDPOINT, { method: 'PATCH', body: payload })
    restoreSaved()
    showToast(saved.value.enabled ? '公告已发布，Core 将自动获取最新内容' : '已保存，Core 将使用内置公告')
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '公告保存失败', 'error')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page page--wide announcement-page">
    <header class="announcement-header">
      <div>
        <h1 class="page-title">Core 公告</h1>
        <p class="description">编辑 YouzaiWorldCore 标题页右侧公告。保存并启用后，客户端会自动获取最新内容。</p>
      </div>
      <md-outlined-button :disabled="loading || saving || dirty" @click="load">
        <md-icon slot="icon">refresh</md-icon>重新加载
      </md-outlined-button>
    </header>

    <p v-if="loading" role="status">正在加载公告…</p>
    <p v-else-if="loadError" class="error" role="alert">{{ loadError }}</p>
    <div v-else-if="saved" class="announcement-grid">
      <section class="card editor-card">
        <h2 class="card-title">公告内容</h2>
        <label class="publish-toggle">
          <md-switch aria-label="启用线上公告" :selected="enabled" :disabled="locked"
            @change="enabled = Boolean(($event.target as HTMLElement & { selected?: boolean }).selected)" />
          <span>启用线上公告</span>
        </label>
        <p class="hint">关闭后使用 Core 内置公告，当前文字仍保存在后台。打开后点击“保存并发布”才会生效。</p>
        <md-outlined-text-field label="公告标题" :value="title" :maxlength="CORE_ANNOUNCEMENT_MAX_TITLE_LENGTH"
          :readonly="locked" required @input="title = ($event.target as HTMLInputElement).value" />
        <md-outlined-text-field label="副标题（可选）" :value="subtitle" :maxlength="CORE_ANNOUNCEMENT_MAX_SUBTITLE_LENGTH"
          :readonly="locked" @input="subtitle = ($event.target as HTMLInputElement).value" />
        <label class="body-label" for="announcement-body">正文</label>
        <textarea id="announcement-body" v-model="bodyText" :readonly="locked" rows="12"
          :maxlength="CORE_ANNOUNCEMENT_MAX_BODY_LENGTH" aria-describedby="body-hint" />
        <p id="body-hint" class="hint">纯文本，每行作为一个段落，允许空行。最多 {{ CORE_ANNOUNCEMENT_MAX_BODY_LINES }} 行、每行 {{ CORE_ANNOUNCEMENT_MAX_LINE_LENGTH }} 字、总计 {{ CORE_ANNOUNCEMENT_MAX_BODY_LENGTH }} 字。</p>
        <p v-if="validationMessage" class="error" role="alert">{{ validationMessage }}</p>
        <div class="save-actions">
          <md-filled-button v-if="canEdit" :disabled="locked || !dirty || !!validationMessage" @click="save">
            <md-icon slot="icon">{{ enabled ? 'campaign' : 'save' }}</md-icon>
            {{ saving ? '正在保存…' : enabled ? '保存并发布' : '保存' }}
          </md-filled-button>
          <md-text-button v-if="canEdit" :disabled="locked || !dirty" @click="restoreSaved">撤销未保存修改</md-text-button>
          <span v-if="dirty" class="hint">有未保存修改</span>
        </div>
        <p class="hint">上次保存：{{ updatedAtLabel }} · {{ saved.enabled ? '线上公告已启用' : '使用内置公告' }}</p>
      </section>

      <aside class="card preview-card">
        <h2 class="card-title">内容预览</h2>
        <p class="hint">{{ dirty ? '预览包含尚未保存的修改。' : '当前保存的公告内容。' }}</p>
        <div class="announcement-preview">
          <h3>{{ title.trim() || '公告标题' }}</h3>
          <div class="preview-body">
            <p v-if="subtitle.trim()" class="preview-subtitle">{{ subtitle.trim() }}</p>
            <p v-for="(line, index) in bodyLines" :key="index">{{ line || '\u00a0' }}</p>
          </div>
        </div>
        <p class="hint">Core 会按游戏窗口宽度自动换行，长正文可以滚动。标题页每 60 秒检查一次公告；接口暂时不可用时保留本次运行中已获取的内容。</p>
        <p class="hint">有待处理更新时，右侧优先显示更新提示；处理更新后显示公告。</p>
        <a href="/api/announcement/core" target="_blank" rel="noopener">查看已发布公告</a>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.announcement-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
.description, .hint { color: var(--md-sys-color-on-surface-variant); line-height: 1.6; }
.description { margin: 8px 0 0; }
.hint { font-size: 13px; margin: 0; }
.announcement-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 24px; align-items: start; }
.editor-card, .preview-card { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.card-title { margin: 0; }
.publish-toggle, .save-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
md-outlined-text-field { width: 100%; }
.body-label { font-size: 14px; }
textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 220px; padding: 16px; border: 1px solid var(--md-sys-color-outline); border-radius: 8px; background: var(--md-sys-color-surface); color: var(--md-sys-color-on-surface); font: inherit; line-height: 1.6; }
textarea:focus { outline: 2px solid var(--md-sys-color-primary); outline-offset: 2px; }
.error { color: var(--md-sys-color-error); }
.announcement-preview { padding: 20px; border-radius: 16px; background: var(--md-sys-color-surface-container-low); border: 1px solid var(--md-sys-color-outline-variant); }
.announcement-preview h3 { color: var(--md-sys-color-primary); overflow-wrap: anywhere; margin: 0 0 16px; }
.preview-body { max-height: 380px; overflow: auto; }
.preview-body p { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; margin: 0 0 8px; }
.preview-subtitle { color: var(--md-sys-color-on-surface-variant); }
a { color: var(--md-sys-color-primary); align-self: flex-start; }
@media (max-width: 900px) { .announcement-grid { grid-template-columns: 1fr; } }
@media (max-width: 600px) { .announcement-header { flex-direction: column; } }
</style>
