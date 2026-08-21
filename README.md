# YouzaiWorldApi

Nuxt Api 服务端与管理页面。开发期监听 `localhost:3000`。

账户系统由本服务端权威保存与认证：游戏账户和会话存入 SQLite 的 `game_accounts` / `game_sessions`，皮肤与披风存入 `game_cosmetics`。管理页面 `/game-accounts` 可创建、注销、重置密码、解除登录锁定并配置会话超时和登录冷却。

服务器模组通过 `X-Yzwc-Server-Key` 调用 `/api/game/*`；本地开发默认密钥为 `youzai-local-development`，部署时可用环境变量 `YZWC_GAME_API_KEY` 覆盖。
