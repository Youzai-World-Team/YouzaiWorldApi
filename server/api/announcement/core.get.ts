import { getPublicCoreAnnouncement } from '../../utils/db'

// 标题页尚未连接游戏服务器，使用独立公开读接口，不需要游戏 Api 密钥。
export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  return getPublicCoreAnnouncement()
})
