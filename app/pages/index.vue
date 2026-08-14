<script setup lang="ts">
import { ref, onMounted } from 'vue'

useHead({ title: '仪表盘' })

interface LoginRecord {
  ip: string
  time: number
}

const logins = ref<LoginRecord[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    logins.value = await $fetch<LoginRecord[]>('/api/auth/logins')
  } catch {
  } finally {
    loading.value = false
  }
})

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN')
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">仪表盘</h1>

    <div class="card" style="max-width: 480px">
      <h2 class="card-title">最近登录 IP</h2>
      <md-list>
        <md-list-item v-for="(l, i) in logins" :key="i">
          <md-icon slot="start">computer</md-icon>
          <span slot="headline">{{ l.ip }}</span>
          <span slot="supporting-text">{{ formatTime(l.time) }}</span>
        </md-list-item>
      </md-list>
      <p v-if="!loading && logins.length === 0" class="empty">暂无登录记录</p>
    </div>
  </div>
</template>

<style scoped>
md-list {
  --md-list-container-color: transparent;
}

.empty {
  margin: 0;
  padding: 16px 0;
  font-size: 14px;
  color: var(--md-sys-color-on-surface-variant);
}
</style>
