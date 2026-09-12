import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { mcsmInstanceKey, type McsmInstanceTarget } from '#shared/mcsm-instance'

interface FileInstance extends McsmInstanceTarget {
  nickname: string
  status: number
  statusLabel: string
  hostIp: string
  remarks: string
}

interface FileInstanceResult {
  configured: boolean
  instanceConfigured: boolean
  instance: FileInstance | null
}

const INSTANCE_REFRESH_INTERVAL_MS = 10_000

/** 文件列表和独立预览都读取站点绑定，不能从地址栏切换到其他实例。 */
export function useMcsmFileInstance() {
  const loading = ref(true)
  const refreshing = ref(false)
  const configured = ref(false)
  const instanceConfigured = ref(false)
  const instance = ref<FileInstance | null>(null)
  const loadError = ref('')
  const instanceKey = computed(() => mcsmInstanceKey(instance.value))
  let disposed = false
  let pending: Promise<void> | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  function refreshInstance(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (pending) return pending
    refreshing.value = true
    pending = (async () => {
      try {
        const result = await $fetch<FileInstanceResult>('/api/admin/mcsm/files/instance')
        if (disposed) return
        configured.value = result.configured
        instanceConfigured.value = result.instanceConfigured
        loadError.value = ''
        instance.value = result.instance
      } catch (error: any) {
        if (disposed) return
        // 失去绑定或权限时停止展示可操作内容，不能继续沿用上次的目标。
        instance.value = null
        loadError.value = error?.data?.statusMessage || error?.statusMessage || '管理实例加载失败，请稍后重试'
      } finally {
        if (!disposed) {
          loading.value = false
          refreshing.value = false
        }
        pending = null
      }
    })()
    return pending
  }

  function refreshWhenVisible() {
    if (!document.hidden) void refreshInstance()
  }

  onMounted(() => {
    void refreshInstance()
    timer = setInterval(refreshWhenVisible, INSTANCE_REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refreshWhenVisible)
  })
  onBeforeUnmount(() => {
    disposed = true
    if (timer) clearInterval(timer)
    window.removeEventListener('focus', refreshWhenVisible)
  })

  return { loading, refreshing, configured, instanceConfigured, instance, instanceKey, loadError, refreshInstance }
}
