# YouzaiWorldApi

Nuxt API 服务端与管理页面。生产环境建议通过 Cloudflare 以 `https://api.mcyzw.top` 提供访问。

账户系统由本服务端权威保存与认证：游戏账户和当前连接会话存入 SQLite 的 `game_accounts` / `game_sessions`，皮肤与披风存入 `game_cosmetics`。管理页面 `/game-accounts` 可创建、注销、重置密码、解除登录锁定并配置登录冷却。玩家每次加入 Minecraft 服务器都必须重新认证。

服务器模组通过 HMAC-SHA256 签名调用 `/api/game/*`。每个请求都必须携带
`X-Yzwc-Timestamp`、`X-Yzwc-Nonce` 和 `X-Yzwc-Signature`，签名密钥由环境变量
`YZWC_GAME_API_KEY` 提供（至少 32 个字符，生产环境必须使用随机值）。

首次启动后访问根目录 `/`，设置首个后台用户名（3 至 32 位）、密码（12 至 128 位）和登录入口（12 至 64 位）。
设置成功后初始化接口会永久关闭，后续只能通过该入口登录。也可在首次启动前同时配置
`YZWC_ADMIN_USERNAME`、`YZWC_ADMIN_PASSWORD` 和 `YZWC_ADMIN_ENTRY` 进行无人值守初始化。
所有者登录后台后可以在 `/admin-users` 创建、停用、重置和删除其他后台用户；所有后台用户都可以在 `/audit-logs` 查看成功的写入操作记录。生产环境应使用 HTTPS
并禁止缓存 API 响应，可复制 `.env.example` 作为配置模板。

若使用网页初始化，请在服务暴露给其他访问者前立即完成设置，避免未初始化实例被他人抢先接管。
