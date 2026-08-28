import {
  getGameAccount,
  insertGameMail,
  listGameAccounts,
  recordAudit,
  requireFeaturePermission,
} from '../../utils/db'
import {
  requireGameUsername,
  requireMailBody,
  requireMailSender,
  requireMailTitle,
  type MailTargetSpec,
  type MailType,
} from '../../utils/game-input'

/** 与模组 MailManager.computeExpireTime 的选项编码保持一致：0=1 天、1=7 天、2=30 天、3=永久。 */
const EXPIRE_OPTION_MS = [
  24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
]
const MAX_SPECIFIC_PLAYERS = 500

/**
 * 后台发布公告 / 通知。
 * <p>
 * 只开放这两种无附件类型：奖励邮件的物品附件必须从管理员物品栏序列化，网页构造不出来。
 * 接收范围同样只支持「全体 / 指定玩家」，这两种 Api 能自己从 game_accounts 解析，
 * 不需要 LuckPerms。发件人取自后台会话，不接受请求体指定，避免冒用他人身份。
 * </p>
 */
export default defineEventHandler(async (event) => {
  const actor = requireFeaturePermission(event, 'mail-publish', 'edit')
  const body = await readBody<any>(event)

  const rawType = String(body?.type ?? '').trim().toUpperCase()
  if (rawType !== 'ANNOUNCEMENT' && rawType !== 'NOTICE') {
    throw createError({ statusCode: 400, statusMessage: '后台只能发布公告或通知，奖励邮件请在游戏内发布' })
  }
  const type = rawType as MailType
  const title = requireMailTitle(body?.title)
  const text = requireMailBody(body?.body)

  const expireOption = Number(body?.expireOption)
  if (!Number.isInteger(expireOption) || expireOption < 0 || expireOption > 3) {
    throw createError({ statusCode: 400, statusMessage: '有效期选项无效' })
  }
  const expireTime = expireOption === 3 ? null : Date.now() + EXPIRE_OPTION_MS[expireOption]!

  const scope = String(body?.scope ?? '')
  let targets: MailTargetSpec[]
  let scopeSummary: string
  let recipients: string[]

  if (scope === 'all') {
    // 与模组 SCOPE_ALL 一致：全部账户（含未注册与离线），uuid 缺失时按离线算法补齐。
    recipients = [...new Set(listGameAccounts()
      .map((account) => account.uuid?.toLowerCase())
      .filter((uuid): uuid is string => Boolean(uuid)))]
    targets = [{ scope: 0, args: [] }]
    scopeSummary = '全体'
  } else if (scope === 'players') {
    const names = Array.isArray(body?.players) ? body.players : null
    if (!names || names.length === 0) {
      throw createError({ statusCode: 400, statusMessage: '请至少选择一个收件玩家' })
    }
    if (names.length > MAX_SPECIFIC_PLAYERS) {
      throw createError({ statusCode: 400, statusMessage: `指定玩家一次最多 ${MAX_SPECIFIC_PLAYERS} 个` })
    }
    // args 存账户表里的规范大小写玩家代号：游戏内编辑界面按名字回查账户。
    const canonical: string[] = []
    const uuids = new Set<string>()
    for (const raw of names) {
      const username = requireGameUsername(raw)
      const account = getGameAccount(username)
      if (!account) {
        throw createError({ statusCode: 404, statusMessage: `玩家不存在：${username}` })
      }
      if (!account.uuid || uuids.has(account.uuid.toLowerCase())) continue
      uuids.add(account.uuid.toLowerCase())
      canonical.push(account.username)
    }
    recipients = [...uuids]
    targets = [{ scope: 2, args: canonical }]
    scopeSummary = `指定:${canonical.join(',')}`
  } else {
    throw createError({ statusCode: 400, statusMessage: '接收范围无效' })
  }

  if (recipients.length === 0) {
    throw createError({ statusCode: 409, statusMessage: '没有可投递的收件人' })
  }

  const result = insertGameMail({
    type,
    sender: requireMailSender(actor.fullName || actor.username),
    targets,
    scopeSummary,
    title,
    body: text,
    expireTime,
    attachments: [],
  }, recipients)

  recordAudit(event, actor, `后台发布${type === 'ANNOUNCEMENT' ? '公告' : '通知'}：${title}`)
  return { ok: true, id: result.mail.id, recipientCount: result.recipients.length }
})
