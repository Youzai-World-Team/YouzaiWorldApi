import { recordAudit, requireFeaturePermission, setMcsmConfig } from '../../utils/db'
import { getPanelSnapshot } from '../../utils/mcsm'

/**
 * 保存 MCSM 面板配置，并立刻拿新配置去面板换一次账户信息当连通性测试。
 * <p>
 * 保存成功但探测失败不回滚：地址写错时把错误信息直接摆给管理员看，比默默存下更好排查。
 * 审计日志只记面板地址，不记 ApiKey。
 * </p>
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const user = requireFeaturePermission(event, 'settings-mcsm', 'edit')
  const body = await readBody<{ baseUrl?: string; apiKey?: string; backupDir?: string }>(event)

  const config = setMcsmConfig({
    baseUrl: body?.baseUrl,
    apiKey: body?.apiKey,
    backupDir: body?.backupDir,
  })
  recordAudit(event, user, `更新 MCSM 面板配置（${config.baseUrl}）`)

  try {
    const snapshot = await getPanelSnapshot()
    return {
      ...config,
      probe: {
        ok: true,
        userName: snapshot.user.userName,
        permissionLabel: snapshot.user.permissionLabel,
        instanceCount: snapshot.instances.length,
        message: '',
      },
    }
  } catch (error: any) {
    return {
      ...config,
      probe: {
        ok: false,
        userName: '',
        permissionLabel: '',
        instanceCount: 0,
        message: String(error?.statusMessage || error?.message || '面板连通性测试失败'),
      },
    }
  }
})
