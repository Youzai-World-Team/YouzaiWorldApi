export const MCSM_UUID_RE = /^[0-9a-f]{32}$/i

export interface McsmInstanceTarget {
  instanceUuid: string
  daemonId: string
}

/** 实例与节点共同标识一个管理目标，统一大小写后再比较。 */
export function mcsmInstanceKey(target: McsmInstanceTarget | null | undefined): string {
  return target ? `${target.daemonId.toLowerCase()}:${target.instanceUuid.toLowerCase()}` : ''
}

export function normalizeMcsmInstanceTarget(value: unknown): McsmInstanceTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (typeof input.instanceUuid !== 'string' || typeof input.daemonId !== 'string') return null
  const instanceUuid = input.instanceUuid.trim().toLowerCase()
  const daemonId = input.daemonId.trim().toLowerCase()
  if (!MCSM_UUID_RE.test(instanceUuid) || !MCSM_UUID_RE.test(daemonId)) return null
  return { instanceUuid, daemonId }
}
