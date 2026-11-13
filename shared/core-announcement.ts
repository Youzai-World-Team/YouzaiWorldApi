export const CORE_ANNOUNCEMENT_MAX_TITLE_LENGTH = 80
export const CORE_ANNOUNCEMENT_MAX_SUBTITLE_LENGTH = 160
export const CORE_ANNOUNCEMENT_MAX_BODY_LINES = 120
export const CORE_ANNOUNCEMENT_MAX_LINE_LENGTH = 500
export const CORE_ANNOUNCEMENT_MAX_BODY_LENGTH = 20_000

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export interface CoreAnnouncementContent {
  enabled: boolean
  title: string
  subtitle: string
  body: string[]
}

export interface CoreAnnouncement extends CoreAnnouncementContent {
  updatedAt: string | null
}

export type PublicCoreAnnouncement = CoreAnnouncement | { enabled: false }

// 尚未发布时继续使用 Core 自带的多语言公告；后台预填现有中文内容。
export const DEFAULT_CORE_ANNOUNCEMENT: CoreAnnouncement = {
  enabled: false,
  title: '服务器公告',
  subtitle: '',
  body: [
    '欢迎来到悠哉世界！',
    '新玩家请先注册账号 (/yzwc account register)',
    '遇到问题请联系管理员',
    '官方网站: mcyzw.top',
  ],
  updatedAt: null,
}

/** 前后端共用的纯文本校验，不接受 HTML 或 Minecraft 富文本组件。 */
export function validateCoreAnnouncementContent(value: unknown): CoreAnnouncementContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('公告内容格式不正确')
  }
  const source = value as Record<string, unknown>
  if (typeof source.enabled !== 'boolean') throw new Error('请指定是否启用线上公告')
  if (typeof source.title !== 'string') throw new Error('公告标题格式不正确')
  const title = source.title.trim()
  if (!title || title.length > CORE_ANNOUNCEMENT_MAX_TITLE_LENGTH || CONTROL_CHARACTERS.test(source.title)) {
    throw new Error(`公告标题需为 1–${CORE_ANNOUNCEMENT_MAX_TITLE_LENGTH} 字的单行文字`)
  }
  if (typeof source.subtitle !== 'string' || source.subtitle.length > CORE_ANNOUNCEMENT_MAX_SUBTITLE_LENGTH
    || CONTROL_CHARACTERS.test(source.subtitle)) {
    throw new Error(`副标题需为不超过 ${CORE_ANNOUNCEMENT_MAX_SUBTITLE_LENGTH} 字的单行文字`)
  }
  if (!Array.isArray(source.body) || !source.body.length || source.body.length > CORE_ANNOUNCEMENT_MAX_BODY_LINES) {
    throw new Error(`正文需为 1–${CORE_ANNOUNCEMENT_MAX_BODY_LINES} 行文字`)
  }
  const body: string[] = []
  for (const line of source.body) {
    if (typeof line !== 'string' || line.length > CORE_ANNOUNCEMENT_MAX_LINE_LENGTH || CONTROL_CHARACTERS.test(line)) {
      throw new Error(`正文每行最多 ${CORE_ANNOUNCEMENT_MAX_LINE_LENGTH} 字，不能包含控制字符`)
    }
    body.push(line)
  }
  if (!body.some((line) => line.trim())) throw new Error('公告正文不能为空')
  if (body.join('\n').length > CORE_ANNOUNCEMENT_MAX_BODY_LENGTH) {
    throw new Error(`公告正文最多 ${CORE_ANNOUNCEMENT_MAX_BODY_LENGTH} 字（含换行）`)
  }
  return { enabled: source.enabled, title, subtitle: source.subtitle.trim(), body }
}
