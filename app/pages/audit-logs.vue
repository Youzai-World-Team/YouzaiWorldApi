<script setup lang="ts">
import { onMounted, ref } from 'vue'

useHead({ title: '操作记录' })

interface AuditLog { id: number; username: string; action: string; method: string; path: string; ip: string; time: number }
const logs = ref<AuditLog[]>([])
const loading = ref(false)
const { showToast } = useToast()

async function loadLogs() {
  loading.value = true
  try { logs.value = await $fetch<AuditLog[]>('/api/admin/audit-logs') }
  catch (error: any) { showToast(error?.data?.statusMessage || '操作记录加载失败', 'error') }
  finally { loading.value = false }
}

function formatDate(value: number) { return new Date(value).toLocaleString('zh-CN') }
onMounted(loadLogs)
</script>

<template>
  <div class="page">
    <div class="page-heading"><div><h1 class="page-title">操作记录</h1><p class="page-subtitle">记录后台用户成功执行的写入操作。</p></div><md-icon-button aria-label="刷新" title="刷新" :disabled="loading" @click="loadLogs"><md-icon>refresh</md-icon></md-icon-button></div>
    <section class="card">
      <div class="table-wrap">
        <table class="data-table"><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>请求</th><th>IP 地址</th></tr></thead><tbody>
          <tr v-for="log in logs" :key="log.id"><td>{{ formatDate(log.time) }}</td><td class="primary-cell">{{ log.username }}</td><td>{{ log.action }}</td><td><code>{{ log.method }} {{ log.path }}</code></td><td class="mono">{{ log.ip }}</td></tr>
        </tbody></table>
        <p v-if="!loading && logs.length === 0" class="empty">暂无操作记录</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.page-subtitle { margin: -12px 0 20px; color: var(--md-sys-color-on-surface-variant); font-size: 13px; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 12px 10px; border-bottom: 1px solid var(--md-sys-color-outline-variant); text-align: left; white-space: nowrap; }
.data-table th { color: var(--md-sys-color-on-surface-variant); font-size: 12px; font-weight: 500; }
.primary-cell { font-weight: 600; }
.mono, code { font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.empty { padding: 16px 0; color: var(--md-sys-color-on-surface-variant); }
</style>
