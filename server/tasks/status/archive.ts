import { getStatusSnapshot } from '../../utils/status'

export default defineTask({
  meta: {
    name: 'status:archive',
    description: '从状态 Worker 同步监控样本到 API 服务端数据库',
  },
  async run() {
    const snapshot = await getStatusSnapshot()
    return {
      result: snapshot.stale ? 'stale' : 'ok',
      generatedAt: snapshot.generatedAt,
    }
  },
})
