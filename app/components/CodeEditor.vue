<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * Monaco 代码编辑器封装。
 * <p>
 * 加载方式沿用「游戏账户邮件模板」页那一套：Monaco 的 ESM 构建在 Vite/Nuxt 下
 * 必须显式提供 worker 构造器，中文语言包又得先临时垫一个 AMD 的 define。
 * 这里额外挂了 json / css / ts 的 worker，因为文件管理要打开的类型比模板页多。
 * </p>
 * <p>
 * 移动端不加载 Monaco（体积和触屏体验都不合适），由调用方用 fallback 插槽给一个
 * 朴素 textarea。
 * </p>
 */
const props = withDefaults(defineProps<{
  modelValue: string
  language?: string
  readonly?: boolean
  height?: string
}>(), {
  language: 'plaintext',
  readonly: false,
  height: '420px',
})

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const host = ref<HTMLElement | null>(null)
const failed = ref(false)
const ready = ref(false)
let editor: any = null
let monacoRef: any = null
// 由编辑器自身回写 modelValue 时不要再把值灌回编辑器，否则光标会跳。
let syncing = false
let themeObserver: MutationObserver | null = null

// 模块级缓存：整页只加载一次 Monaco。
let monacoLoadPromise: Promise<any> | null = null

async function loadMonaco() {
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

      const [{ default: EditorWorker }, { default: JsonWorker }, { default: CssWorker }, { default: TsWorker }] =
        await Promise.all([
          import('monaco-editor/esm/vs/editor/editor.worker.js?worker'),
          import('monaco-editor/esm/vs/language/json/json.worker.js?worker'),
          import('monaco-editor/esm/vs/language/css/css.worker.js?worker'),
          import('monaco-editor/esm/vs/language/typescript/ts.worker.js?worker'),
        ])
      const environment = globalScope.MonacoEnvironment || {}
      globalScope.MonacoEnvironment = {
        ...environment,
        getWorker(_workerId: string, label: string) {
          if (label === 'json') return new JsonWorker()
          if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
          if (label === 'typescript' || label === 'javascript') return new TsWorker()
          return new EditorWorker()
        },
      }
      return import('monaco-editor/esm/vs/editor/editor.main.js')
    })()
  }
  try {
    return await monacoLoadPromise
  } catch (error) {
    monacoLoadPromise = null
    throw error
  }
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches)
    ? 'vs-dark'
    : 'vs'
}

async function create() {
  const element = host.value
  if (!element || editor) return
  let monaco: any
  try {
    monaco = await loadMonaco()
  } catch (error) {
    console.error('Monaco Editor 加载失败', error)
    failed.value = true
    return
  }
  if (!monaco || !element.isConnected || editor) return
  monacoRef = monaco

  editor = monaco.editor.create(element, {
    value: props.modelValue,
    language: props.language,
    theme: currentTheme(),
    readOnly: props.readonly,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    lineHeight: 21,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'off',
    scrollBeyondLastLine: false,
    renderWhitespace: 'selection',
    padding: { top: 12, bottom: 12 },
    lineNumbersMinChars: 3,
    glyphMargin: false,
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    renderLineHighlight: 'none',
    renderLineHighlightOnlyWhenFocus: false,
  })
  ready.value = true

  editor.onDidChangeModelContent(() => {
    syncing = true
    emit('update:modelValue', editor.getValue())
    syncing = false
  })

  // 跟随后台的明暗主题切换。
  themeObserver = new MutationObserver(() => monacoRef?.editor.setTheme(currentTheme()))
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}

watch(() => props.modelValue, (value) => {
  if (!editor || syncing) return
  if (editor.getValue() !== value) editor.setValue(value ?? '')
})

watch(() => props.language, (language) => {
  if (!editor || !monacoRef) return
  monacoRef.editor.setModelLanguage(editor.getModel(), language || 'plaintext')
})

watch(() => props.readonly, (readonly) => editor?.updateOptions({ readOnly: readonly }))

/** 供父组件在弹窗尺寸变化（如进入全屏）后手动触发重排。 */
function layout() {
  editor?.layout()
}

function focus() {
  editor?.focus()
}
defineExpose({ layout, focus })

onMounted(create)

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
  editor?.dispose()
  editor = null
  monacoRef = null
})
</script>

<template>
  <div class="monaco-wrap" :style="{ height }">
    <div v-show="!failed" ref="host" class="monaco-host"></div>
    <p v-if="failed" class="monaco-failed">
      代码编辑器加载失败，已回退到纯文本编辑。
    </p>
    <textarea
      v-if="failed"
      class="monaco-fallback"
      spellcheck="false"
      wrap="off"
      :readonly="readonly"
      :value="modelValue"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    ></textarea>
    <div v-if="!ready && !failed" class="monaco-loading">编辑器加载中…</div>
  </div>
</template>

<style scoped>
.monaco-wrap { position: relative; width: 100%; min-height: 160px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; overflow: hidden; background: var(--md-sys-color-surface); }
.monaco-host { width: 100%; height: 100%; }

.monaco-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--md-sys-color-on-surface-variant); font-size: 13px; pointer-events: none; }
.monaco-failed { margin: 0; padding: 8px 12px; color: var(--md-sys-color-error); font-size: 12px; }
.monaco-fallback { width: 100%; height: calc(100% - 34px); box-sizing: border-box; padding: 12px; overflow: auto; border: 0; background: transparent; color: var(--md-sys-color-on-surface); font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.6; white-space: pre; resize: none; }
.monaco-fallback:focus { outline: 2px solid var(--md-sys-color-primary); outline-offset: -2px; }
</style>
