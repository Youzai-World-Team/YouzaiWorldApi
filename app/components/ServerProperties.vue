<script setup lang="ts">
import { computed, ref, watch } from 'vue'

// server.properties 编辑器。面板把文件解析成带类型的键值对回来，
// 所以这里能按类型渲染成开关 / 数字框 / 文本框，而不是让人手改文本。
const props = defineProps<{
  uuid: string
  daemonId: string
  canEdit: boolean
}>()

interface ConfigFile {
  fileName: string
  type: string
  label: string
}

// 常用项拎到最前面单独成组，剩下的按字母序折叠在「全部配置项」里。
// Minecraft 的 server.properties 有七十来项，平铺出来没法用。
const HIGHLIGHT_KEYS = [
  'motd', 'max-players', 'difficulty', 'gamemode', 'pvp',
  'white-list', 'enforce-whitelist', 'online-mode', 'allow-flight',
  'spawn-protection', 'view-distance', 'simulation-distance',
]

// 这几项是枚举，给下拉而不是自由输入。
const ENUM_OPTIONS: Record<string, string[]> = {
  difficulty: ['peaceful', 'easy', 'normal', 'hard'],
  gamemode: ['survival', 'creative', 'adventure', 'spectator'],
}

const { showToast } = useToast()

const loading = ref(true)
const saving = ref(false)
const files = ref<ConfigFile[]>([])
const fileName = ref('')
// original 是服务端最后一次确认的值，用来算「改了哪些」和「放弃修改」。
const original = ref<Record<string, unknown>>({})
const draft = ref<Record<string, unknown>>({})
const showAll = ref(false)
const keyword = ref('')

const allKeys = computed(() => Object.keys(draft.value).sort((a, b) => a.localeCompare(b, 'en')))
const highlightKeys = computed(() => HIGHLIGHT_KEYS.filter((key) => key in draft.value))
const otherKeys = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return allKeys.value
    .filter((key) => !highlightKeys.value.includes(key))
    .filter((key) => !text || key.toLowerCase().includes(text))
})
const changedKeys = computed(() =>
  allKeys.value.filter((key) => String(draft.value[key] ?? '') !== String(original.value[key] ?? '')))
const dirty = computed(() => changedKeys.value.length > 0)

function labelFor(key: string) {
  return key
}

function isBoolean(key: string) {
  return typeof draft.value[key] === 'boolean'
}

function isNumber(key: string) {
  return typeof draft.value[key] === 'number'
}

function optionsFor(key: string) {
  return ENUM_OPTIONS[key] || null
}

function onToggle(key: string, event: Event) {
  draft.value = { ...draft.value, [key]: (event.target as any).selected }
}

function onText(key: string, event: Event) {
  draft.value = { ...draft.value, [key]: (event.target as HTMLInputElement).value }
}

function onNumber(key: string, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const parsed = Number(raw)
  draft.value = { ...draft.value, [key]: raw === '' ? 0 : (Number.isFinite(parsed) ? parsed : draft.value[key]) }
}

function onSelect(key: string, event: Event) {
  draft.value = { ...draft.value, [key]: (event.target as HTMLSelectElement).value }
}

async function load() {
  if (!props.uuid) return
  loading.value = true
  try {
    const result = await $fetch<{ files: ConfigFile[]; fileName: string; values: Record<string, unknown> }>(
      '/api/admin/mcsm/properties',
      { query: { uuid: props.uuid, daemonId: props.daemonId, fileName: fileName.value || undefined } },
    )
    files.value = result.files
    fileName.value = result.fileName
    original.value = result.values
    draft.value = { ...result.values }
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '服务器设置加载失败', 'error')
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!props.canEdit || saving.value || !dirty.value) return
  saving.value = true
  try {
    const result = await $fetch<{ values: Record<string, unknown>; changed: string[] }>(
      '/api/admin/mcsm/properties',
      {
        method: 'PATCH',
        body: { uuid: props.uuid, daemonId: props.daemonId, fileName: fileName.value, values: draft.value },
      },
    )
    original.value = result.values
    draft.value = { ...result.values }
    showToast(result.changed.length ? `已保存 ${result.changed.length} 项，重启后生效` : '没有实际改动')
  } catch (error: any) {
    showToast(error?.data?.statusMessage || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

function reset() {
  draft.value = { ...original.value }
}

watch(() => [props.uuid, props.daemonId], () => {
  fileName.value = ''
  void load()
}, { immediate: true })
</script>

<template>
  <section class="card">
    <div class="card-heading">
      <h2 class="card-title">
        服务器设置
        <span v-if="dirty" class="badge badge-dirty">{{ changedKeys.length }} 项未保存</span>
      </h2>
      <div class="heading-actions">
        <md-icon-button aria-label="重新加载" title="重新加载" :disabled="loading" @click="load">
          <md-icon>refresh</md-icon>
        </md-icon-button>
      </div>
    </div>

    <p class="card-note">
      直接编辑实例的 <code>{{ fileName || 'server.properties' }}</code>。
      Minecraft 只在启动时读这个文件，**改完要重启服务器才生效**。
      <span v-if="!canEdit">当前账户没有「服务器设置」的修改权限，只能查看。</span>
    </p>

    <p v-if="loading" class="empty">加载中…</p>
    <template v-else-if="allKeys.length">
      <h3 class="section-title">常用</h3>
      <div class="config-grid">
        <div v-for="key in highlightKeys" :key="key" class="config-item">
          <label class="config-label" :for="`cfg-${key}`">{{ labelFor(key) }}</label>

          <label v-if="isBoolean(key)" class="switch-row">
            <md-switch
              :id="`cfg-${key}`"
              :selected="draft[key] as boolean"
              :disabled="!canEdit"
              @change="onToggle(key, $event)"
            ></md-switch>
            <span>{{ draft[key] ? '开' : '关' }}</span>
          </label>

          <md-outlined-select
            v-else-if="optionsFor(key)"
            :id="`cfg-${key}`"
            class="config-control"
            :value="String(draft[key] ?? '')"
            :disabled="!canEdit"
            @change="onSelect(key, $event)"
          >
            <md-select-option
              v-for="option in optionsFor(key)"
              :key="option"
              :value="option"
              :selected="String(draft[key] ?? '') === option"
            >
              <div slot="headline">{{ option }}</div>
            </md-select-option>
          </md-outlined-select>

          <md-outlined-text-field
            v-else-if="isNumber(key)"
            :id="`cfg-${key}`"
            class="config-control"
            type="number"
            :value="String(draft[key] ?? '')"
            :readonly="!canEdit"
            @input="onNumber(key, $event)"
          ></md-outlined-text-field>

          <md-outlined-text-field
            v-else
            :id="`cfg-${key}`"
            class="config-control"
            :value="String(draft[key] ?? '')"
            :readonly="!canEdit"
            @input="onText(key, $event)"
          ></md-outlined-text-field>
        </div>
      </div>

      <div class="all-toggle">
        <md-text-button @click="showAll = !showAll">
          <md-icon slot="icon">{{ showAll ? 'expand_less' : 'expand_more' }}</md-icon>
          {{ showAll ? '收起全部配置项' : `展开全部配置项（${allKeys.length}）` }}
        </md-text-button>
      </div>

      <template v-if="showAll">
        <md-outlined-text-field
          class="filter"
          label="筛选配置项"
          :value="keyword"
          @input="keyword = ($event.target as HTMLInputElement).value"
        >
          <md-icon slot="leading-icon">search</md-icon>
        </md-outlined-text-field>

        <div class="config-grid">
          <div v-for="key in otherKeys" :key="key" class="config-item">
            <label class="config-label" :for="`all-${key}`">{{ key }}</label>
            <label v-if="isBoolean(key)" class="switch-row">
              <md-switch
                :id="`all-${key}`"
                :selected="draft[key] as boolean"
                :disabled="!canEdit"
                @change="onToggle(key, $event)"
              ></md-switch>
              <span>{{ draft[key] ? '开' : '关' }}</span>
            </label>
            <md-outlined-text-field
              v-else-if="isNumber(key)"
              :id="`all-${key}`"
              class="config-control"
              type="number"
              :value="String(draft[key] ?? '')"
              :readonly="!canEdit"
              @input="onNumber(key, $event)"
            ></md-outlined-text-field>
            <md-outlined-text-field
              v-else
              :id="`all-${key}`"
              class="config-control"
              :value="String(draft[key] ?? '')"
              :readonly="!canEdit"
              @input="onText(key, $event)"
            ></md-outlined-text-field>
          </div>
        </div>
        <p v-if="!otherKeys.length" class="empty">没有匹配的配置项</p>
      </template>

      <div v-if="canEdit" class="form-actions">
        <md-filled-button :disabled="saving || !dirty" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </md-filled-button>
        <md-outlined-button :disabled="saving || !dirty" @click="reset">放弃修改</md-outlined-button>
      </div>
      <p v-if="dirty" class="card-note changed-list">
        待保存：{{ changedKeys.join('、') }}
      </p>
    </template>
    <p v-else class="empty">没有读到配置项</p>
  </section>
</template>

<style scoped>
.card-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.card-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.heading-actions { display: flex; align-items: center; gap: 8px; }
.card-note { margin: 8px 0 0; font-size: 13px; line-height: 1.7; color: var(--md-sys-color-on-surface-variant); }
.card-note code { padding: 1px 5px; border-radius: 4px; background: var(--md-sys-color-surface); font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.section-title { margin: 20px 0 10px; font-size: 13px; font-weight: 600; color: var(--md-sys-color-on-surface-variant); }
.badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; line-height: 18px; background: var(--md-sys-color-surface-variant); color: var(--md-sys-color-on-surface-variant); }
.badge-dirty { background: var(--md-sys-color-tertiary-container); color: var(--md-sys-color-on-tertiary-container); }
.config-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px 20px; margin-top: 4px; }
.config-item { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.config-label { font-size: 12px; color: var(--md-sys-color-on-surface-variant); font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.config-control { width: 100%; }
.switch-row { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--md-sys-color-on-surface-variant); min-height: var(--app-control-height, 48px); }
.all-toggle { margin-top: 16px; }
.filter { width: min(100%, 320px); margin-bottom: 14px; }
.form-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
.changed-list { overflow-wrap: anywhere; }
.empty { padding: 16px 0; color: var(--md-sys-color-on-surface-variant); font-size: 14px; }
</style>
