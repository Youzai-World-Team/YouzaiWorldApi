import {
  listGameAccounts,
  listGameCosmeticMeta,
  listMojangProfileCache,
  requireAuth,
  type GameCosmeticMeta,
  type MojangProfileCache,
} from '../../utils/db'
import { isMojangLookupDisabled } from '../../utils/mojang'

const SKIN_SLOTS = new Set(['skin.png', 'skin_slim.png'])
const CAPE_SLOT = 'cloak.png'

interface LocalSlotWire {
  slot: string
  sha256: string
  bytes: number
  width: number
  height: number
  updated_at: number
}

function slotWire(meta: GameCosmeticMeta): LocalSlotWire {
  return {
    slot: meta.slot,
    sha256: meta.sha256,
    bytes: meta.bytes,
    width: meta.width,
    height: meta.height,
    updated_at: meta.updatedAt,
  }
}

function mojangWire(profile: MojangProfileCache | undefined) {
  if (!profile) return null
  return {
    status: profile.status,
    username: profile.username,
    uuid: profile.profileUuid,
    skin_hash: profile.skinHash || null,
    cape_hash: profile.capeHash || null,
    model: profile.model || null,
    message: profile.message,
    checked_at: profile.checkedAt,
    stale: profile.stale,
  }
}

/**
 * 后台外观总览。只读本地数据库：账户表 + game_cosmetics 元数据 + 已缓存的正版档案，
 * 不在这里外呼 Mojang，需要正版信息时由前端调用 /api/admin/game-cosmetics/lookup。
 */
export default defineEventHandler((event) => {
  requireAuth(event)

  const cosmeticsByUuid = new Map<string, GameCosmeticMeta[]>()
  for (const meta of listGameCosmeticMeta()) {
    const list = cosmeticsByUuid.get(meta.uuid)
    if (list) list.push(meta)
    else cosmeticsByUuid.set(meta.uuid, [meta])
  }

  const profiles = new Map(listMojangProfileCache().map((profile) => [profile.usernameLower, profile]))
  const claimedUuids = new Set<string>()

  const accounts = listGameAccounts().map((account) => {
    const uuid = String(account.uuid ?? '').toLowerCase()
    if (uuid) claimedUuids.add(uuid)
    const slots = cosmeticsByUuid.get(uuid) ?? []
    const skin = slots.find((meta) => SKIN_SLOTS.has(meta.slot))
    const cape = slots.find((meta) => meta.slot === CAPE_SLOT)
    return {
      username: account.username,
      uuid: account.uuid,
      registered: Boolean(account.password),
      last_authenticated_date: account.lastAuthenticatedDate,
      local: {
        skin: skin ? slotWire(skin) : null,
        cape: cape ? slotWire(cape) : null,
        // 模组上传时 skin.png 与 skin_slim.png 互斥，槽位名即玩家正在使用的模型。
        model: skin ? (skin.slot === 'skin_slim.png' ? 'slim' : 'classic') : null,
        updated_at: slots.reduce((latest, meta) => Math.max(latest, meta.updatedAt), 0),
      },
      mojang: mojangWire(profiles.get(account.usernameLower)),
    }
  })

  // 账户注销后模组会同步删除外观，这里出现的记录说明两边不一致，单独列出便于排查。
  const orphans = [...cosmeticsByUuid.entries()]
    .filter(([uuid]) => !claimedUuids.has(uuid))
    .map(([uuid, slots]) => ({
      uuid,
      slots: slots.map(slotWire),
      updated_at: slots.reduce((latest, meta) => Math.max(latest, meta.updatedAt), 0),
    }))

  return { accounts, orphans, mojang_lookup_disabled: isMojangLookupDisabled() }
})
