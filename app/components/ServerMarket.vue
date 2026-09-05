<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ uuid: string; daemonId: string; canView: boolean; canEdit: boolean }>()
const { showToast } = useToast()
const config = ref<any>(null)
const packages = ref<any[]>([])
const loading = ref(false)
const installing = ref<string | null>(null)
function errorMessage(error: any, fallback: string) { return error?.data?.statusMessage || error?.statusMessage || fallback }
function list(data: any): any[] { return Array.isArray(data) ? data : Array.isArray(data?.packages) ? data.packages : Array.isArray(data?.items) ? data.items : [] }
async function load() {
  if (!props.canView) return
  loading.value = true
  try {
    const [configResult, packageResult] = await Promise.all([$fetch('/api/admin/mcsm/market/config'), $fetch('/api/admin/mcsm/market/packages')])
    config.value = configResult
    packages.value = list(packageResult)
  } catch (error: any) { showToast(errorMessage(error, 'Market 信息加载失败'), 'error') }
  finally { loading.value = false }
}
async function install(item: any) {
  if (!props.canEdit || installing.value) return
  const title = String(item.title || item.name || '').trim()
  if (!title) return
  installing.value = title
  try { await $fetch('/api/admin/mcsm/market/install', { method: 'POST', body: { uuid: props.uuid, daemonId: props.daemonId, title, description: String(item.description || '') } }); showToast('Market 安装任务已提交') }
  catch (error: any) { showToast(errorMessage(error, 'Market 安装失败'), 'error') }
  finally { installing.value = null }
}
watch(() => [props.uuid, props.daemonId, props.canView], () => { void load() }, { immediate: true })
</script>

<template>
  <section v-if="canView" class="card market-card"><div class="card-heading"><div><h2 class="card-title">Market 预设包</h2><p class="card-note">读取面板 Market 目录，并向当前实例提交预设包安装任务。</p></div><md-icon-button title="刷新 Market" :disabled="loading" @click="load"><md-icon>refresh</md-icon></md-icon-button></div><p v-if="config && config.enabled === false" class="empty">面板未启用 Market 插件。</p><p v-if="loading" class="empty">加载中…</p><div v-else class="package-grid"><article v-for="item in packages" :key="item.title || item.name" class="package-item"><h3>{{ item.title || item.name }}</h3><p>{{ item.description || '没有描述' }}</p><div class="package-actions"><span class="muted">{{ item.version || item.type || '' }}</span><md-filled-button v-if="canEdit" :disabled="installing !== null" @click="install(item)">{{ installing === (item.title || item.name) ? '提交中…' : '安装到当前实例' }}</md-filled-button></div></article></div><p v-if="!loading && !packages.length" class="empty">Market 没有返回可安装的预设包。</p></section>
</template>

<style scoped>
.card-heading,.package-actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }.card-heading { justify-content:space-between; align-items:flex-start; }.card-note,.empty,.muted { color:var(--md-sys-color-on-surface-variant); font-size:13px; }.package-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; margin-top:14px; }.package-item { padding:14px; border:1px solid var(--md-sys-color-outline-variant); }.package-item h3 { margin:0 0 8px; font-size:15px; }.package-item p { min-height:42px; color:var(--md-sys-color-on-surface-variant); font-size:13px; }.package-actions { justify-content:space-between; }
</style>
