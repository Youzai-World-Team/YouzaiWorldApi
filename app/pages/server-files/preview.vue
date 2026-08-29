<script setup lang="ts">
import { computed } from 'vue'

/**
 * 独立预览页。
 * <p>
 * 「服务器文件」页的预览弹窗里点「在新页面打开」会带着 query 跳到这里，
 * 好处是能整页铺开、可以单独收藏或分享给同事（对方仍需自己的后台权限）。
 * 路由权限由 {@code adminPageKeyForPath} 里那条 {@code /server-files/} 前缀规则
 * 挂回「服务器文件」页，不会因为匹配不到页面定义而绕过检查。
 * </p>
 */
const route = useRoute()
const access = useAdminAccess()
const canEdit = computed(() => access.levelForKey('server-files') === 'edit'
  && access.featureLevelForKey('server-files-edit') === 'edit')

const uuid = computed(() => String(route.query.uuid || ''))
const daemonId = computed(() => String(route.query.daemonId || ''))
const path = computed(() => String(route.query.path || ''))
const kind = computed(() => String(route.query.kind || 'binary'))
const size = computed(() => Number(route.query.size) || 0)

const fileName = computed(() => path.value.split('/').filter(Boolean).pop() || '文件预览')
const ready = computed(() => Boolean(uuid.value && daemonId.value && path.value))

useHead({ title: () => `${fileName.value} · 服务器文件` })

const downloadUrl = computed(() => {
  const params = new URLSearchParams({ uuid: uuid.value, daemonId: daemonId.value, path: path.value, download: '1' })
  return `/api/admin/mcsm/files/raw?${params.toString()}`
})

function backToFiles() {
  void navigateTo('/server-files')
}
</script>

<template>
  <div class="page page--wide">
    <div class="page-heading">
      <div class="heading-main">
        <md-icon-button aria-label="返回文件列表" title="返回文件列表" @click="backToFiles">
          <md-icon>arrow_back</md-icon>
        </md-icon-button>
        <div class="heading-text">
          <h1 class="page-title">{{ fileName }}</h1>
          <p class="page-subtitle mono">{{ path || '缺少文件路径' }}</p>
        </div>
      </div>
      <a v-if="ready" class="plain-link" :href="downloadUrl">
        <md-outlined-button>
          <md-icon slot="icon">download</md-icon>
          下载
        </md-outlined-button>
      </a>
    </div>

    <section class="card">
      <p v-if="!ready" class="empty">
        缺少必要的参数（实例与文件路径），请从「服务器文件」页打开预览。
      </p>
      <FilePreview
        v-else
        :uuid="uuid"
        :daemon-id="daemonId"
        :path="path"
        :kind="kind"
        :size="size"
        :can-edit="canEdit"
        editor-height="calc(100dvh - 300px)"
      />
    </section>
  </div>
</template>

<style scoped>
.page-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
.heading-main { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.heading-text { min-width: 0; }
.page-title { margin: 4px 0 0; overflow-wrap: anywhere; }
.page-subtitle { margin: 4px 0 0; color: var(--md-sys-color-on-surface-variant); font-size: 13px; overflow-wrap: anywhere; }
.mono { font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.plain-link { text-decoration: none; flex-shrink: 0; }
.empty { padding: 24px 0; color: var(--md-sys-color-on-surface-variant); font-size: 14px; }
@media (max-width: 640px) {
  .page-heading { align-items: stretch; flex-direction: column; }
  .heading-main { width: 100%; }
  .plain-link,
  .plain-link md-outlined-button { width: 100%; }
}
</style>
