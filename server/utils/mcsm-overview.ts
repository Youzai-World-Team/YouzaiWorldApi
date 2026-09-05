import { createError } from 'h3'
import { assertInstanceAllowed, callPanel } from './mcsm'

export async function getPanelOverview(): Promise<unknown> {
  return callPanel('/api/overview')
}

export async function getInstanceOperationLogs(
  uuid: string,
  daemonId: string,
  limitValue: unknown,
): Promise<unknown> {
  await assertInstanceAllowed(uuid, daemonId)
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(limitValue) || 50)))
  return callPanel('/api/overview/instance_operation_logs', {
    query: { instanceId: uuid, daemonId, limit },
  })
}

export async function getJavaRuntimes(uuid: string, daemonId: string): Promise<unknown> {
  await assertInstanceAllowed(uuid, daemonId)
  return callPanel('/api/java_manager/list', {
    query: { uuid, daemonId, instanceId: uuid },
  })
}

export async function getMarketConfig(): Promise<unknown> {
  return callPanel('/api/market/config')
}

export async function getMarketPackages(): Promise<unknown> {
  return callPanel('/api/market/packages')
}

export async function installMarketPackage(
  uuid: string,
  daemonId: string,
  title: unknown,
  description: unknown,
): Promise<unknown> {
  await assertInstanceAllowed(uuid, daemonId)
  const packageTitle = String(title ?? '').trim()
  const packageDescription = String(description ?? '').trim()
  if (!packageTitle || packageTitle.length > 200 || packageDescription.length > 2000) {
    throw createError({ statusCode: 400, statusMessage: '预设包信息不合法' })
  }
  return callPanel('/api/market/install_instance', {
    method: 'POST',
    query: { uuid, daemonId },
    body: { title: packageTitle, description: packageDescription },
  })
}

export async function getDesktopLayout(): Promise<unknown> {
  return callPanel('/api/overview/desktop_layout')
}

export async function setDesktopLayout(layout: unknown): Promise<unknown> {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    throw createError({ statusCode: 400, statusMessage: '桌面布局格式不正确' })
  }
  return callPanel('/api/overview/desktop_layout', { method: 'POST', body: layout })
}
