import { MAP_UPLOAD_COMMAND, type GameMapUploadRequest } from '#shared/game-map'
import { getMcsmManagedInstance, mcsmConfigured } from './db'
import { assertManagedInstanceAllowed, createManagedInstanceGuard, sendCommand } from './mcsm'

/** 仅通过站点绑定的实例发送固定上传命令，不接受用户指定的实例或任意指令。 */
export async function requestGameMapUpload(): Promise<GameMapUploadRequest> {
  const target = getMcsmManagedInstance()
  if (!mcsmConfigured() || !target) return {
    status: 'waiting', message: '等待服务器同步。可绑定 MCSManager 管理实例后请求上传，或在游戏服务器控制台执行 yzwc map upload。',
  }
  try {
    const assertCurrent = createManagedInstanceGuard(target.instanceUuid, target.daemonId)
    const instance = await assertManagedInstanceAllowed(target.instanceUuid, target.daemonId)
    if (instance.status !== 3) return { status: 'waiting', message: `管理实例「${instance.nickname || target.instanceUuid}」尚未运行；启动后在服务器控制台执行 yzwc map upload。` }
    assertCurrent()
    await sendCommand(target.instanceUuid, target.daemonId, MAP_UPLOAD_COMMAND)
    return { status: 'requested', message: '已向管理实例发送上传命令，等待 Core 开始同步。若正在上传，Core 会在本轮结束后按重试机制补传。' }
  } catch (error: any) {
    return { status: 'failed', message: `上传命令发送失败：${error?.statusMessage || '无法连接管理实例'}。可在服务器控制台执行 yzwc map upload。` }
  }
}
