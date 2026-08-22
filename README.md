# YouzaiWorldApi

Nuxt API 服务端与管理页面。生产环境建议通过 Cloudflare 以 `https://api.mcyzw.top` 提供访问。

账户系统由本服务端权威保存与认证：游戏账户和当前连接会话存入 SQLite 的 `game_accounts` / `game_sessions`，皮肤与披风存入 `game_cosmetics`，服务器邮件存入 `game_mails` / `game_mail_refs`。管理页面 `/game-accounts` 可创建、注销、重置密码、解除登录锁定并配置登录冷却。玩家每次加入 Minecraft 服务器都必须重新认证。

服务器模组通过 HMAC-SHA256 签名调用 `/api/game/*`。每个请求都必须携带
`X-Yzwc-Timestamp`、`X-Yzwc-Nonce` 和 `X-Yzwc-Signature`，签名密钥由环境变量
`YZWC_GAME_API_KEY` 提供（至少 32 个字符，生产环境必须使用随机值）。

## 游戏账户邮箱验证与密码找回

在后台 `/game-accounts` 勾选“注册需邮箱验证”并保存 SMTP 配置后，游戏账户注册改为三步流程。以下请求均需使用上面的 HMAC 请求头签名：

1. `POST /api/game/account` 按原结构提交注册信息。接口返回 `{"ok":false,"msg":"需要邮箱注册","session_id":"...","expires_in":900}`，此时账户尚未创建。
2. `POST /api/game/account-email/send` 提交 `{"session_id":"...","email":"player@example.com"}`。接口发送六位验证码，并返回验证码有效时间和再次发送的等待时间。
3. `POST /api/game/account-email/verify` 提交 `{"session_id":"...","code":"123456"}`。校验成功后创建账户，响应结构与原注册成功响应一致，并额外包含 `msg: "注册成功"`。

注册会话 15 分钟失效，验证码 10 分钟失效且 60 秒内不可重复发送；连续输入错误 5 次后注册会话失效。验证成功后邮箱会与游戏账户唯一绑定，已绑定邮箱不能再用于其他账户注册。SMTP 密码使用游戏 API 密钥派生的密钥加密保存，修改该密钥后需要在后台重新保存 SMTP 密码。

已绑定邮箱的玩家可以通过游戏登录页找回密码：

1. `POST /api/game/account-password-reset/send` 提交 `{"username":"Player","email":"player@example.com"}`。账户与邮箱匹配时发送六位验证码，并返回 `session_id`、`expires_in` 与 `resend_after`。
2. `POST /api/game/account-password-reset/verify` 提交 `{"session_id":"...","code":"123456","new_password":"..."}`。验证成功后更新密码、清除登录锁定状态，并撤销该账户的全部旧登录令牌。

找回密码会话与验证码均在 10 分钟后失效，60 秒内不可重复发送；连续输入错误 5 次后会话失效。找回流程仅适用于已经通过邮箱验证并绑定邮箱的账户，且所有请求同样需要游戏 API HMAC 签名。

已登录玩家可从模组暂停菜单进入账户管理页面。下列敏感接口除 HMAC 签名外，还必须携带登录接口返回的 `Authorization: Bearer <token>` 游戏会话；账户身份只取自该会话，不信任请求体中的玩家名：

1. `POST /api/game/change-password` 提交 `{"oldPassword":"...","newPassword":"..."}`。成功后撤销该账户全部登录令牌、找回密码会话与换绑邮箱会话，玩家需要重新登录。
2. `POST /api/game/account-email-change/send` 提交 `{"password":"当前密码","email":"new@example.com"}`。当前密码正确且目标邮箱未被其他账户占用时，向新邮箱发送六位验证码，并返回 `session_id`、`expires_in` 与 `resend_after`。
3. `POST /api/game/account-email-change/verify` 提交 `{"session_id":"...","code":"123456"}`。验证码和当前游戏会话属于同一账户时，原子更新绑定邮箱并返回最新账户数据。
4. `POST /api/game/deactivate` 提交 `{"password":"当前密码"}`。成功后删除账户、全部认证/邮箱会话及其外观数据。

换绑邮箱会话与验证码均在 10 分钟后失效，60 秒内不可重复发送；连续输入错误 5 次后会话失效。数据库唯一索引与完成验证时的事务复检共同保证每个邮箱最多绑定一个游戏账户。

## 邮件系统

服务器邮件也由本服务端权威保存：邮件正文（含附件）存入 SQLite 的 `game_mails`，每玩家收件箱引用存入 `game_mail_refs`。游戏模组不再保存任何邮件文件，玩家客户端的收件箱、发布、领取都最终落到下列接口上。以下请求同样需要游戏 API 的 HMAC 请求头签名。

| 方法与路径 | 用途 |
|-----------|------|
| `GET /api/game/mail/inbox?uuid=&keep_starred=` | 玩家收件箱 + 未读数。`keep_starred=false` 时顺带剔除过期未星标的引用；隐藏中的邮件不下发 |
| `GET /api/game/mail/unread?uuid=` | 单个玩家未读数 |
| `POST /api/game/mail/unread` | 批量未读数，提交 `{"uuids":["..."]}`，返回 `{"counts":{"<uuid>":n}}`（一次最多 500 人） |
| `GET /api/game/mail/sent` | 已发送邮件摘要列表，不含正文与附件 |
| `GET /api/game/mail/detail?id=&viewer=` | 单封详情 + 编辑前置判定（`can_edit` / `need_hidden` / `deny_reason`）；`viewer` 可省略 |
| `POST /api/game/mail/refs` | 批量取某封邮件在指定玩家处的引用，提交 `{"mail_id":"...","uuids":[...]}`（一次最多 500 人） |
| `POST /api/game/mail` | 发布邮件 |
| `PATCH /api/game/mail` | 编辑邮件，按新收件人列表对收件箱引用做 diff |
| `DELETE /api/game/mail?id=` | 撤回邮件，返回原收件人 |
| `POST /api/game/mail/hidden` | 编辑期间隐藏 / 恢复，提交 `{"id":"...","hidden":true}` |
| `POST /api/game/mail/action` | 已读 / 星标 / 取消星标 / 删除，提交 `{"uuid":"...","mail_id":"...","action":"read\|star\|unstar\|delete"}` |
| `POST /api/game/mail/claim` | 原子领取奖励 |
| `POST /api/game/mail/purge` | 清理过期邮件，提交 `{"keep_starred":true}` |
| `DELETE /api/game/mail/box?uuid=` | 账户注销时清空该玩家收件箱 |

发布与编辑提交 `{sender, type, targets, scope_summary, title, body, expire_time, attachments, recipients}`（编辑另需 `id`，可选 `hidden`）。`type` 为 `ANNOUNCEMENT` / `NOTICE` / `REWARD`，`REWARD` 必须至少带一个附件；`expire_time` 为毫秒时间戳，`null` 表示永久。`targets` 是模组界面选择的原始接收范围（`{scope, args}`，`scope` 0=全体、1=非管理、2=指定玩家、3=角色组），只用于回填编辑界面与展示；实际收件人由 `recipients` 给出——非管理与角色组需要查 LuckPerms，只有模组能解析，因此由模组解析后一并提交。

领取采用「先记账后发放」：`claim` 在一个事务里校验邮件类型、是否过期、引用是否存在与是否已领取，通过后立即写入 `claimed` 并返回附件，再由模组在游戏内实际发放。这样极端情况下最多丢一次奖励，但不会出现重复领取。

清理过期邮件时 `keep_starred` 为真则保留被任意玩家星标过的过期邮件，并一并剔除指向已撤回邮件的悬空引用；返回的 `affected` 用于让模组刷新在线玩家的未读徽标。

后台 `/mail`（导航里叫「服内邮件」）可以查看已发布的邮件，并发布公告与通知：列表给出每封的类型、发件人、接收范围、收件人数与已读 / 已领取统计，点「查看」看正文、接收范围明细、附件以及逐个收件人的读 / 收藏 / 领取状态。这几个接口走后台会话鉴权（`requireAuth`），与上面签名调用的 `/api/game/mail/*` 是两套独立入口：

| 方法与路径 | 用途 |
|-----------|------|
| `GET /api/admin/mails` | 邮件列表 + 阅读 / 领取统计 |
| `GET /api/admin/mails/:id` | 单封详情 + 逐收件人状态 |
| `POST /api/admin/mails` | 发布公告 / 通知 |

发布提交 `{type, title, body, expireOption, scope, players}`。`type` 只接受 `ANNOUNCEMENT` / `NOTICE`；`expireOption` 与游戏内一致（0=1 天、1=7 天、2=30 天、3=永久）；`scope` 为 `all`（全体账户）或 `players`（配 `players` 玩家代号数组，一次最多 500 个，重复与大小写差异会归一，写库时回填账户表里的规范大小写以便游戏内编辑界面回查）。发件人取当前后台账户的全名或用户名，**不接受请求体指定**，避免冒用他人身份；每次发布都会记入 `/audit-logs`。

奖励邮件、编辑与撤回仍然只在游戏内进行：物品附件的 NBT 只能从管理员物品栏里的物品序列化，网页无法构造。后台发布的邮件没有 S2C 触发点，玩家打开信箱即可看到；未读徽标由模组按 `mail_module.unread_refresh_interval_ticks`（默认约 2.5 分钟）批量刷新后点亮，不是即时的。

首次启动后访问根目录 `/`，设置首个后台用户名（3 至 32 位）、密码（12 至 128 位）、登录入口（12 至 64 位），以及 Turnstile 站点密钥、服务端密钥和允许的前端 hostname。
设置成功后初始化接口会永久关闭，后续只能通过该入口登录。也可在首次启动前同时配置
`YZWC_ADMIN_USERNAME`、`YZWC_ADMIN_PASSWORD` 和 `YZWC_ADMIN_ENTRY` 进行无人值守初始化。
所有者登录后台后可以在 `/admin-users` 创建、停用、重置和删除其他后台用户；所有后台用户都可以在 `/audit-logs` 查看成功的写入操作记录。生产环境应使用 HTTPS
并禁止缓存 API 响应，可复制 `.env.example` 作为配置模板。

若使用网页初始化，请在服务暴露给其他访问者前立即完成设置，避免未初始化实例被他人抢先接管。

后台登录页使用 Cloudflare Turnstile 进行人机验证。OOBE 初始化页填写的 Turnstile 配置会保存到服务端数据库，
其中 Secret Key 不会通过公开接口返回。也可以在部署前通过环境变量配置 `TURNSTILE_SECRET`，并将
`TURNSTILE_HOSTNAMES` 设置为当前部署允许的前端 hostname；生产环境应使用 `api.mcyzw.top`，不要把
`localhost` 或 `127.0.0.1` 加入生产允许列表。本地测试时可单独设置
`TURNSTILE_HOSTNAMES=localhost,127.0.0.1`。公开站点密钥由
`NUXT_PUBLIC_TURNSTILE_SITE_KEY` 提供；如果使用 OOBE 初始化，则直接在初始化页面填写站点密钥。
