# YouzaiWorldApi

Nuxt API 服务端与管理页面。生产环境建议通过 Cloudflare 以 `https://api.mcyzw.top` 提供访问。

账户系统由本服务端权威保存与认证：游戏账户和当前连接会话存入 SQLite 的 `game_accounts` / `game_sessions`，皮肤与披风存入 `game_cosmetics`，服务器邮件存入 `game_mails` / `game_mail_refs`，域名收件存入 `domain_mails` / `domain_mail_attachments`。管理页面 `/game-accounts` 可创建、注销、重置密码、解除登录锁定并配置登录冷却。玩家每次加入 Minecraft 服务器都必须重新认证。

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

## 皮肤与披风查看

后台 `/game-cosmetics`（导航里叫「账户装扮」）逐个账户展示皮肤与披风：卡片给出正面与背面的 2D 预览、来源标签、模型（经典 / 纤细）和上传时间，点「查看详情」还能看到每个槽位的图片尺寸、文件大小、SHA-256、上传时间以及可直接打开的 PNG 原图。「游戏账户」页每行的衣架图标会带着 `?username=` 跳到这里并直接展开该账户。

外观有两个来源，页面上分开呈现：

- **离线上传**：模组只允许离线会话上传，文件存在 `game_cosmetics` 的 `skin.png` / `skin_slim.png` / `cloak.png` 三个槽位里，这也是服务器实际下发给其他玩家的那一套。两个皮肤槽位互斥，哪个非空就说明玩家在用哪种模型。
- **Mojang 正版档案**：服务器跑离线模式，账户表里的 UUID 由玩家代号推导，因此只能按玩家代号去 Mojang 查同名档案。查到的皮肤 / 披风仅作参考展示，服务器不会下发；同名档案也只说明 Mojang 存在这个名字，不代表该玩家通过了正版验证。

正版查询结果按玩家代号写入 `mojang_profiles` 缓存 6 小时（查询失败只缓存 5 分钟，避免一次网络抖动或限流把账户压住半天），页面加载时只补齐缺失或过期的账户，进程内另有 10 分钟 150 次的令牌桶兜底，避免把 Mojang 的名称查询配额打满。材质由服务端代理下发（页面 CSP 的 `img-src` 只允许 `'self'`），入参只有材质哈希、URL 由服务端自己拼 `https://textures.minecraft.net/texture/<hash>`，档案里指向其他主机的材质地址会被直接丢弃。设置 `YZWC_MOJANG_DISABLED=1` 可关闭全部外呼。

下列接口走后台会话鉴权（`requireAuth`），与模组签名调用的 `/api/game/cosmetic*` 是两套独立入口：

| 方法与路径 | 用途 |
|-----------|------|
| `GET /api/admin/game-cosmetics` | 账户 + 本地外观元数据 + 已缓存的正版档案；只读数据库，不外呼 |
| `POST /api/admin/game-cosmetics/lookup` | 向 Mojang 查询正版档案，提交 `{"usernames":[...],"refresh":false}`（一次最多 60 个，并发 4） |
| `GET /api/admin/game-cosmetics/texture?uuid=&slot=` | 本地上传的外观 PNG 原图 |
| `GET /api/admin/game-cosmetics/mojang-texture?hash=` | 代理官方材质 PNG，命中进程内缓存时不再外呼 |

总览接口顺带列出 `orphans`——`game_cosmetics` 里还有数据但账户表已无对应账户的 UUID，通常是注销时删除外观失败留下的残留。`lookup` 虽然是 POST 但属于只读查询（用请求体是为了带玩家名单），因此不记入 `/audit-logs`。

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

## 域名邮件

发往 `@mcyzw.top` 的来信由 `YouzaiWorldDonaimEmail`（Cloudflare Email Worker，挂在 Email Routing 的 catch-all 规则上）收下，解析 MIME 后投递到本服务端保存：邮件本体存入 SQLite 的 `domain_mails`，附件存入 `domain_mail_attachments`。后台 `/domain-mail`（导航里叫「域名邮件」）可以查看和删除，**转发与发信按需求暂未实现**。

Worker 用 HMAC-SHA256 签名调用 `POST /api/inbound-mail`，请求头与规范串和游戏接口同一套（`X-Yzwc-Timestamp`、`X-Yzwc-Nonce`、`X-Yzwc-Signature`，规范串为 `timestamp.nonce.METHOD.path.sha256(body)`，±300 秒时间窗，nonce 10 分钟防重放），但**密钥是独立的**：Worker 被攻破也只能写入收件，碰不到 `/api/game/*`。

密钥在后台 `/settings`（站点设置）的「域名邮件投递密钥」区域填写，也可以点「随机生成」现场生成一个 32 字节随机值。与游戏 API 密钥同一套优先级：数据库设置（`inbound_mail.key`）优先，未配置时回退到环境变量 `YZWC_INBOUND_MAIL_KEY`；生产环境推荐用后台保存，因为 Nitro 运行时不会读项目根目录的 `.env`。两处都没有有效值时投递接口返回 503，设置页会给出提示。密钥长度 32 至 512 位且不能含空白字符，保存后需要把同一个值写进 Worker 的 `INBOUND_MAIL_KEY` Secret。

该区域受功能权限 `settings-inbound-mail-key` 控制，默认 `hidden`：所有者始终可见，其他后台账户需要在 `/permissions` 里单独授权，且不会超过其「站点设置」页面权限。修改会记入 `/audit-logs`，只记「改过」不记密钥内容。

投递接口不受后台页面权限中间件管辖（由签名把关），也不受 `security.ts` 那 256 KiB 的请求体上限约束——一封带附件的邮件 base64 后可达十几 MiB，改由 `server/middleware/inbound-mail-auth.ts` 按 20 MiB 单独限制，并要求声明 `Content-Length`。

同一个 `Message-ID` 重复投递是幂等的：命中已有记录时直接返回原 id 并置 `duplicate`，不会插入第二条。Worker 在网络抖动后会重试，这个幂等分支保证后台不会看到重复邮件。没有 `Message-ID` 的邮件不参与去重（唯一索引是 `WHERE message_id <> ''` 的部分索引）。

后台读取接口走后台会话鉴权（`requireAuth`），与签名投递的入口是两套：

| 方法与路径 | 用途 |
|-----------|------|
| `POST /api/inbound-mail` | Worker 投递收件（HMAC 签名，非后台会话） |
| `GET /api/admin/domain-mails` | 邮件列表；不含正文与附件二进制 |
| `GET /api/admin/domain-mails/:id` | 单封详情：正文、收件人/抄送、附件元信息 |
| `DELETE /api/admin/domain-mails/:id` | 删除邮件，附件级联删除，记入 `/audit-logs` |
| `GET /api/admin/domain-mails/attachment?mail=&id=` | 下载附件原文 |
| `GET /api/admin/domain-mails/download?mail=` | 下载整封邮件的 `.eml`（重建，见下） |
| `GET /api/auth/inbound-mail-key` | 读取当前投递密钥与其来源（数据库 / 环境变量 / 未配置） |
| `POST /api/auth/inbound-mail-key` | 保存投递密钥到数据库设置 |

列表给出主题、发件人、收件地址、发送时间（邮件头 `Date`，缺失或畸形时回退接收时间并标注）、接收时间、附件数、原信大小与 SPF / DKIM / DMARC 结论；详情另给信封发件人、回复地址、收件人与抄送、`Message-ID`，以及正文和附件清单。删除需要该页的 `edit` 权限，只有 `view` 时删除入口不显示。

### 下载 `.eml`

列表每行与详情弹窗都有下载按钮，产出可直接用 Thunderbird / Outlook / Apple Mail 打开的 `.eml`。

**这是按库里字段重建的，不是原始报文。** Worker 只上传解析后的字段（部分头部、纯文本正文、HTML 正文、附件），原始 MIME 字节没有入库，所以头部顺序、非必要头部与原始分段结构无法还原，字节级取证需要另存原始 MIME。重建文件里带 `X-Yzwc-Reconstructed: yes; original-mime-not-stored` 头明示这一点，另有 `X-Yzwc-Mail-Id` / `X-Yzwc-Envelope-From` / `X-Yzwc-Envelope-To` / `X-Yzwc-Received-Time` 保留库里的元信息，被体积预算丢掉的附件用 `X-Yzwc-Dropped-Attachment` 登记名称与原始大小。

实现在 `server/utils/eml.ts`：正文与附件统一 base64 传输编码（安全承载 UTF-8 与二进制，避开 quoted-printable 的行长细节），头部非 ASCII 走 RFC 2047 encoded-word 并按 45 字节切分（不切断码点，单词不超 75 字符），附件名同时给出 ASCII 回退与 RFC 2231 的 `filename*`。分段边界含 `-`，而 base64 字母表里没有 `-`，因此边界不可能与正文碰撞。头部取值一律剔除控制字符，防止用主题或显示名注入 `Bcc:` 之类的新头部。下载响应与附件同样强制 `Content-Disposition: attachment` + `nosniff`，不给浏览器内联解析陌生来信的机会。

### 两条安全约束

catch-all 收的是互联网上任何人发来的信，因此正文与附件一律当敌对数据处理：

- **HTML 正文经净化后只在沙箱里渲染。** 详情页的正文分「沙箱预览 / 纯文本 / HTML 源码」三个视图，默认沙箱预览。渲染走三层互不依赖的防御：
  1. 服务端 `server/utils/html-sanitize.ts` 按**允许列表**净化 HTML 与 CSS。只保留排版必需的标签、属性、CSS 属性；`<script>` / `<iframe>` / `<svg>` / `<form>` / `<object>` 等连内容一起丢；没被列出的属性（含全部 `on*`、`srcset`、`formaction`）一律丢弃。`<img>` 只放行内联 `data:` 图片，远程与 `cid:` 引用换成「图片已拦截」占位（远程图片会泄露管理员 IP 并向发信方确认地址有效）。CSS 里含 `url()` / `expression()` 的声明整条丢弃，`@import` / `@font-face` / `@charset` 一律丢（无法引入远程样式表），只放行 `@media` / `@supports`；选择器与 at-rule 条件走白名单字符集，因此净化产物里不可能出现 `<`，不会提前闭合宿主的 `</style>`。`position` / `opacity` / `visibility` 不在允许列表里，`display` 放行但单独丢掉 `display:none`——既保住多栏与响应式排版，又让垃圾邮件藏起来的文字现形。
  2. 前端把结果塞进 `<iframe sandbox="allow-scripts" srcdoc>`。**不给** `allow-same-origin`，文档处于不透明源，读不到后台页面的 DOM / Cookie / localStorage；也没有 `allow-popups` / `allow-top-navigation`，点击跳不出去。
  3. 该文档自带 CSP：`default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-<每次随机>'`。外呼全被挡住，脚本只允许带本次 nonce 的那一段（即我们注入的链接点击转发脚本）；邮件里万一漏过来的脚本没有 nonce，照样执行不了。

  **链接不会跳转。** `<a>` 被降级成带 `data-yzw-href` 的 `<span>`；沙箱里那段脚本捕获点击后 `postMessage` 给后台页面，由后台弹窗显示完整地址，提示管理员确认后**手动复制到别处打开**，并给出钓鱼提醒。后台收到消息时会校验 `event.source` 是该 iframe、重新核对协议只接受 `http(s)` / `mailto`，再以纯文本渲染。`javascript:` / `data:` 之类的协议连 `data-yzw-href` 都不写入，只标注「已移除不安全链接」。

  净化器遇到引号不配对这类无法确定标签边界的输入时**失败关闭**（停止输出剩余内容），与浏览器的实际渲染结果一致，不去猜测。`<meta>` / `<link>` / `<base>` 等 void 标签按单标签丢弃而非「找结束标签」，否则会一路吞到文末把正文整体丢掉。`<body>` 降级成 `<div>` 输出以保住它身上的 `class` / `bgcolor`（邮件常在 body 上设整页背景）。原始 HTML 一并返回，供「HTML 源码」视图做钓鱼排查——那里只是转义后的文本，不会被解析执行。

  净化器遇到引号不配对这类无法确定标签边界的输入时**失败关闭**（停止输出剩余内容），与浏览器的实际渲染结果一致，不去猜测。原始 HTML 一并返回，供「HTML 源码」视图做钓鱼排查——那里只是转义后的文本，不会被解析执行。

- **附件一律按 `application/octet-stream` + `Content-Disposition: attachment` 下发，不使用邮件声明的 MIME 类型。** 否则一个 HTML 或 SVG 附件照原类型内联返回就能在后台域名下执行脚本。文件名做过清洗，非 ASCII 走 RFC 5987 的 `filename*`。邮件里被拦掉的内联图片，可以在附件表里找到对应条目下载查看。

对应地，解析与校验一律**宽进严出**：畸形的 `From` / `Reply-To`、没见过的 SPF/DKIM/DMARC 结论都不会让整封信被拒（前者原样保留供排查，后者归零），只有收件地址本身非法才拒收——把一封信丢掉比存下一条脏数据更糟。

### 体积与保留上限

Cloudflare 入站单封上限 25 MiB。Worker 与服务端的预算必须一致（`YouzaiWorldDonaimEmail/src/config.js` ↔ `server/utils/inbound-mail.ts`）：纯文本正文 256 KiB、HTML 正文 1 MiB、单个附件 6 MiB、附件合计 12 MiB、附件条数 32。超出的正文被截断，超出的附件只保留元信息（文件名、类型、原始大小）而不存内容——后台显示「未保存」，不提供下载。任何裁剪都会置 `truncated`，列表上显示「已截断」。

收件表保留最近 2000 封（`DOMAIN_MAIL_RETENTION_ROWS`），超出后按接收时间淘汰最旧的，附件一并删除。附件是二进制入库，没有上限会把磁盘吃满。

## 服务器管理

后台 `/server-manage`（导航里叫「服务器管理」）通过 [MCSManager](https://docs.mcsmanager.com/zh_cn/apis/get_apikey.html) 面板管理 Minecraft 服务器实例：看运行状态与控制台输出、发送命令、启动 / 停止 / 重启 / 强制结束，以及把世界存档打包成备份。

面板凭据在 `/settings`（站点设置）的「MCSManager 面板」区域填写：面板地址、ApiKey、备份目录。**ApiKey 与该面板账户同权限**（可发命令、改文件、停服），因此和 Turnstile 服务端密钥同一套处理方式——写进 `settings` 表后接口只回报「是否已配置」，永不回显明文，留空提交表示沿用旧值。优先级同样是数据库设置（`mcsm.base_url` / `mcsm.api_key` / `mcsm.backup_dir`）优先，未配置时回退到 `YZWC_MCSM_BASE_URL` / `YZWC_MCSM_API_KEY`。保存时会立刻拿新配置去面板换一次账户信息作连通性测试，地址写错会当场报出来（配置仍会存下，方便改一处再试）。

浏览器从不直接连面板，所有调用都由本服务端代发（`server/utils/mcsm.ts`），ApiKey 只出现在服务端拼出的 URL 里。

### 实例范围

实例列表来自面板的 `GET /api/auth`（当前账户信息）而不是 `GET /api/service/remote_service_instances`：后者要求面板管理员权限，普通账户的 ApiKey 会被 403，而账户信息里的 `instances` 恰好就是「这把钥匙能碰的实例」。该响应里还夹着 `apiKey` / `secret` / `token`，服务端只挑实例元信息映射出去。

每个写操作（电源、命令、备份）执行前都会用 `assertInstanceAllowed` 复核 uuid / daemonId 确实在这份列表里。少了这一步，本服务端就成了「拿面板 ApiKey 打任意实例」的跳板——后台用户是能自由构造请求体的。

### 控制台

控制台默认是**实时推流**，不是定时轮询：新日志会即时推到页面。

链路是「浏览器 ←SSE← 本服务端 ←WebSocket← 守护进程」。MCSManager 的 stdout 推流走守护进程（节点）的 socket.io：先 `POST /api/protected_instance/stream_channel` 换一次性票据（`{password, addr, prefix}`，和备份下载同一个套路），再连 `ws://<addr>/socket.io/?EIO=4&transport=websocket`，握手后 emit `stream/auth` 带上密码，随后收 `instance/stdout` 事件（载荷是 `{data:{instanceUuid, text}}`，会核对 `instanceUuid` 防止串流）。

**为什么不让浏览器直连守护进程**：票据里的节点地址是明文 `ws://` 的第三方主机，HTTPS 后台页面会因混合内容被浏览器拦下，页面 CSP 的 `connect-src 'self'` 也不放行，而且节点地址随面板调度变动。改由服务端中继后，ApiKey 和节点地址都不出服务端，浏览器只跟 `api.mcyzw.top` 说话，CSP 一行都不用放宽。

服务端这一侧没有引入 `socket.io-client`：engine.io v4 是纯文本裸帧协议，用 Node 22 内置的全局 `WebSocket` 实现「连接 → `40` CONNECT → `stream/auth` → 收 `42["instance/stdout",…]`」这一条链路只要几十行，见 `server/utils/mcsm-console-stream.ts`。客户端按握手包给的 `pingInterval` 主动发 `2` 心跳，服务端发来 `2` 时回 `3`。

浏览器侧用 `EventSource`（`GET /api/admin/mcsm/stream`），自带断线重连。SSE 事件：`history` 先补一段历史铺满屏幕，`log` 是增量输出，`status` 报通道状态（`open` / `closed` / `error` / `warn`），`ping` 是 25 秒心跳（防中间代理按空闲掐断）。三道保护：同时挂着的流最多 8 条（每条占一个到守护进程的 WebSocket），单条流每 10 秒最多推 256 KiB（崩服刷屏时超预算就丢并提示），页面侧留存上限 40 万字符、增量按 60ms 合帧后再并入，避免每个片段都触发重渲染。

关掉页面上的「实时输出」开关会断开 SSE、停在当前快照上，改用手动刷新——那条路走的是 `GET /api/admin/mcsm/log`，即面板的 `outputlog` 接口。它返回整份终端历史（可达数十万字符），按 `size` 只取末尾 2 万 / 6 万 / 20 万字符。**注意 `size` 的单位是字符数**，不是官方文档写的「1KB ~ 2048KB」：传 1200 精确返回 1200 个字符，不带 `size` 才返回全部，按 KB 理解会让控制台只剩几百个字符。

不论走哪条路，面板都开着伪终端，输出里混着 ANSI 清行、光标移动、颜色和窗口标题序列，服务端 `stripAnsi` 会逐类剥掉再下发纯文本。pty 按终端宽度硬折的行没法复原，这一点和面板自带的控制台一致。

实例状态（玩家数、CPU、内存）没有推流通道，仍然每 10 秒轮询一次；标签页不可见时跳过，上一轮没回来也不叠加下一轮。命令走 `POST /api/admin/mcsm/command`，长度上限 512 字符，换行和控制字符一律拒绝（命令是拼进查询串的，换行会被 pty 当成多条命令），命令原文写入 `/audit-logs`。实时模式下命令回显会自己推过来，不需要手动补拉。

### 备份

MCSManager 没有备份接口，这里用它的文件接口实现：`POST /api/files/compress`（`type: 1`）把实例根目录下选中的几个一级目录压缩成备份目录里的一个 zip，文件名为 `标签-时间戳.zip`。打包目标必须是面板真实列出来的一级目录，不接受调用方自己拼的路径，备份目录自身也排除在外（否则历史备份会一层层套进新备份）。恢复用同一个接口的 `type: 2` 解压回实例根目录，**只允许在实例已停止时执行**——运行中的服务器持有世界文件句柄，边跑边覆盖存档要么写不进去、要么退出时用内存里的旧状态把恢复结果再盖一遍。

大世界压缩耗时可能超过 15 秒的请求超时，此时面板侧的压缩任务仍在继续，刷新备份列表就能看到结果。面板没有可用的进度接口（`/api/files/status` 的计数在压缩全程都是 0），所以页面给不出进度条。

**运行中的服务器会占着部分文件的句柄**：实测在服务器运行时压缩 `/mods` 会失败（`The decompression and compression program is abnormal`），因为 JVM 正持有那些 jar。世界存档目录可以正常压缩。要整机备份就先停服。

下载走面板的 `POST /api/files/download` 换一次性密码，地址直连守护进程（节点）而不经过本服务端——备份动辄几百 MB，代理一遍只是白占内存；节点是内网域名或浏览器拦下不安全下载时，改用面板自带的文件管理下载。

### 服务器设置（server.properties）

面板的 `GET/PUT /api/protected_instance/process_config/file`（带 `fileName` + `type`，缺 `type` 会 500）把 `server.properties` 解析成**带类型的键值对**回来——布尔就是 `true/false`、数字就是数字，所以页面能按类型渲染成开关、下拉和数字框，不用让人手改文本。常用的十几项单独成组，其余七十来项折叠在「全部配置项」里并支持筛选。

写入是**整份覆盖**，所以保存时先读一遍旧值、算出真正变化的项，只把这些写进 `/audit-logs`（七十项全记下来没法看，而「谁把 `white-list` 关了」恰恰是事后最需要查的）。服务端逐项校验键名与取值：只接受字符串 / 数字 / 布尔 / null，字符串不许含换行（换行会把一行配置拆成两行，等于凭空插入配置项），嵌套对象会被面板序列化成 `[object Object]` 所以直接拒掉。可编辑的文件走白名单（目前只有 `server.properties`）——这个接口能读写实例目录内的文件，不加白名单等于开放任意配置改写。

**Minecraft 只在启动时读 `server.properties`，改完要重启服务器才生效**，页面上有提示，但不会代替管理员决定何时重启。

### 计划任务

面板的计划任务接口官方文档没有覆盖，下面的字段是实测结论：

| 字段 | 含义 |
|------|------|
| `name` | 任务名，同时也是删除时的 `task_name` |
| `count` | 执行次数，`-1` 表示无限 |
| `type` | `1` = 循环（`time` 是间隔秒数，最小 3）、`2` = cron（`time` 是 5 段或 6 段表达式）、`3` = 指定时刻（`time` 形如 `2026-01-01 04:00:00`） |
| `actions` | 动作数组，形如 `[{ type, payload }]` |

动作类型为 `command`（`payload` 是命令）/ `start` / `stop` / `restart` / `kill`。**注意 `start` 与 HTTP 电源接口的 `open` 不同名。**

最要紧的一点：**面板对 `actions` 的结构不做任何校验，传什么都原样落库**，但只有 `{type, payload}` 这种写法执行器才真的会执行。写成 `{action, payload}` 或纯字符串同样返回成功，任务却会到点静默不执行。所以服务端把这个结构固定死，不让调用方自由传。

创建走「计划任务」区域权限，任务名、触发条件与动作一起记入 `/audit-logs`。面板对单个实例的任务数量有上限，超出时把它的原文报错透给页面。

## 服务器文件（独立页面）

完整的文件管理器，取代了之前「服务器管理」页里的简单文件卡片。功能包括：

- **浏览**：面包屑导航、按名称/大小/时间排序、目录内搜索、多选
- **预览**：
  - **图片/音视频**：直接在页面里内联显示（字节由本服务端同源转发）
  - **文本文件**：Monaco 代码编辑器打开并带语法高亮（json/yml/properties/md/sh/js/ts/css/xml…）
  - **Markdown**：渲染后的 HTML 预览（编辑权限下同时显示编辑器）
  - **Office 文档**：Word (`.docx`)、Excel (`.xlsx`) 转 HTML 预览
  - **PDF**：iframe 内联展示
  - **压缩包**：显示 `.zip`/`.jar` 内的文件列表
- **编辑**：文本文件可以在 Monaco 里直接改并保存，支持语法高亮、自动缩进、查找替换
- **上传**：支持拖拽，逐个分块上传并显示进度条，单文件上限 256 MiB；分块可避开反向代理对单个请求体的默认限制
- **下载**：同源代理转发，避免混合内容拦截与 CORS
- **增删改**：新建目录/文件、重命名、复制/移动到其他目录、批量删除（递归，无回收站）
- **压缩/解压**：把选中项打包成 zip（最多 50 项），或把 zip 解压到当前目录

预览模式有三种：

1. **弹窗预览**（默认）：点文件名或「预览/编辑」按钮
2. **新页面预览**：弹窗右上角的「在新页面打开」图标，可以单独收藏或分享给同事
3. **网页全屏**：弹窗右上角的全屏图标，铺满整个视口（非浏览器原生全屏，按 Esc 退出）

守护进程的下载接口不支持 `Range` 请求，音视频只能顺序播放，拖动进度条通常无效。文本编辑是整份覆盖写且没有并发保护——两人同时改同一文件，后保存的会覆盖先保存的。

### 权限

整页默认 `hidden`（能读写实例内任意文件），需要所有者单独放开。`view` 档可以浏览和预览，`edit` 档才能上传、编辑、删除。

### 这把 ApiKey 用不到的接口

面板账户是普通用户（`permission: 1`），下列接口一律 403，不要再尝试：`/api/auth/search`（用户管理）、`/api/service/remote_service_instances`（按节点列实例）、`/api/service/remote_services_system`（节点系统信息）、`/api/environment/*`（Docker 镜像与容器）、`/api/service/remote_service`（节点增删改），以及 **`PUT /api/instance`（修改实例配置）**——所以昵称、自动重启开关这类实例级设置只能在面板里改。

另外两项确认做不到：`/api/files/status` 虽然能调通（返回 `instanceFileTask` / `globalFileTask` / 磁盘列表），但压缩全程这些计数都是 0，**没法用它做备份进度**；`info.playersChart` 是空数组，**做不了在线人数曲线**。

### 权限

页面权限键 `server-manage`，**新账户默认只有 `view`**（能看状态和控制台，动不了任何东西）。三个破坏性区域另有独立功能权限，默认全部 `hidden`，只有 `hidden` / `edit` 两档：

| 功能权限键 | 覆盖操作 |
|-----------|---------|
| `server-manage-power` | 启动 / 停止 / 重启 / 强制结束进程 |
| `server-manage-command` | 向控制台发送命令 |
| `server-manage-backup` | 创建 / 下载 / 恢复 / 删除备份 |
| `server-manage-properties` | 修改 server.properties（白名单、正版验证、难度等） |
| `server-manage-schedule` | 创建 / 删除计划任务 |
| `server-manage-files` | 浏览实例目录、在线编辑文本文件 |

前三个只有 `hidden` / `edit` 两档；后三个有 `hidden` / `view` / `edit` 三档，`view` 时卡片只读、`hidden` 时整个卡片不渲染。所有者始终是 `edit`，其他账户要在 `/permissions` 里单独授权，且不会超过其「服务器管理」页面权限。所有写操作都记入 `/audit-logs`。

| 方法与路径 | 用途 | 需要的权限 |
|-----------|------|-----------|
| `GET /api/admin/mcsm/instances` | 面板是否已配置、ApiKey 身份、可管理实例列表 | 页面 `view` |
| `GET /api/admin/mcsm/instance?uuid=&daemonId=` | 单实例运行详情 | 页面 `view` |
| `GET /api/admin/mcsm/stream?uuid=&daemonId=&history=` | 实时控制台（SSE，服务端中继守护进程推流） | 页面 `view` |
| `GET /api/admin/mcsm/log?uuid=&daemonId=&size=` | 控制台输出快照（已剥 ANSI），暂停实时时用 | 页面 `view` |
| `GET /api/admin/mcsm/backups?uuid=&daemonId=` | 备份列表 + 可备份的一级目录 | 页面 `view` |
| `POST /api/admin/mcsm/power` | 电源操作 | `server-manage-power` |
| `POST /api/admin/mcsm/command` | 发送命令 | `server-manage-command` |
| `POST /api/admin/mcsm/backups` | 创建备份 | `server-manage-backup` |
| `DELETE /api/admin/mcsm/backups` | 删除备份 | `server-manage-backup` |
| `POST /api/admin/mcsm/backups/restore` | 恢复备份（要求实例已停止） | `server-manage-backup` |
| `POST /api/admin/mcsm/backups/download` | 换取一次性下载地址 | `server-manage-backup` |
| `GET /api/admin/mcsm/properties` | 读取解析后的 server.properties | 页面 `view` |
| `PATCH /api/admin/mcsm/properties` | 整份写回配置 | `server-manage-properties` |
| `GET /api/admin/mcsm/schedules` | 计划任务列表 + 类型/动作枚举 | 页面 `view` |
| `POST /api/admin/mcsm/schedules` | 创建计划任务 | `server-manage-schedule` |
| `DELETE /api/admin/mcsm/schedules` | 删除计划任务 | `server-manage-schedule` |
| `GET /api/admin/mcsm/instances` | 读取面板配置与实例列表 | `server-manage` 或 `server-files` 任一 `view` |
| `GET /api/admin/mcsm/files?path=&page=` | 浏览实例目录（附带类型判定） | `server-files` `view` |
| `GET /api/admin/mcsm/files/raw?path=` | 流式代理文件字节（预览/下载） | `server-files` `view` |
| `GET /api/admin/mcsm/file?path=` | 读取文本文件 | `server-files` `view` |
| `PUT /api/admin/mcsm/file` | 保存文本文件 | `server-files` `edit` |
| `POST /api/admin/mcsm/files/create` | 新建目录或文件 | `server-files` `edit` |
| `POST /api/admin/mcsm/files/rename` | 重命名 | `server-files` `edit` |
| `POST /api/admin/mcsm/files/transfer` | 批量复制或移动 | `server-files` `edit` |
| `POST /api/admin/mcsm/files/delete` | 批量删除 | `server-files` `edit` |
| `POST /api/admin/mcsm/files/archive` | 压缩/解压 | `server-files` `edit` |
| `PUT /api/admin/mcsm/files/upload-chunk` | 分块上传（完成后流式代理到守护进程） | `server-files` `edit` |
| `GET /api/admin/mcsm-settings` | 读取面板地址、备份目录与「ApiKey 是否已配置」 | `settings-mcsm` `view` |
| `PATCH /api/admin/mcsm-settings` | 保存面板配置并测试连通性 | `settings-mcsm` `edit` |

下载虽然只是换个地址，但拿到它等于能把整个世界拷走，因此也按「备份管理」把关并记入操作记录。

## GitHub Release 自动部署

远端服务器的完整配置步骤请参阅 [DEPLOYMENT.md](./DEPLOYMENT.md)。

仓库中的 `.github/workflows/release.yml` 监听 GitHub Release 的 `published` 事件。创建并正式发布 Release 后，GitHub Actions 会使用 Node.js 22 与 pnpm 安装锁定依赖、执行 `pnpm run build`，把 `.output` **目录内的内容**打包成 zip，再携带部署令牌上传到 `POST /api/deploy`，最后轮询公开接口确认重启后的 API 已恢复响应。同一仓库的多个 Release 部署会排队执行。草稿和仅创建 tag 不会触发；预发布版本只要执行了 Publish 也会触发。

首次上线仍需人工准备生产目录、完成一次构建并注册进程守护服务，因为尚未运行的 API 无法接收部署包。此后每次发布 Release 才能通过下面的流程更新：

```text
GitHub Release (published)
  -> GitHub Actions 构建 .output
  -> POST <DEPLOY_URL>/api/deploy
  -> 校验令牌与 zip
  -> 暂存并校验 Nuxt 产物
  -> 原子替换生产目录的 .output
  -> 退出或执行重启命令
  -> 进程守护器拉起新版本
```

### GitHub Secrets

在仓库 `Settings -> Secrets and variables -> Actions` 中配置：

| Secret | 内容 |
|--------|------|
| `DEPLOY_URL` | 已运行 API 的外部地址，例如 `https://api.mcyzw.top`，不要带 `/api/deploy` |
| `DEPLOY_TOKEN` | 随机部署令牌，必须与生产环境 `YZWC_DEPLOY_TOKEN` 完全一致；至少 32 个字符且不含空白 |

部署地址必须允许 GitHub Actions 访问 `POST /api/deploy`。若前面有 Cloudflare、Nginx 或其他反向代理，还要确认其请求体上限和超时时间能够接收部署包；应用自身限制压缩包最多 100 MiB。

### 生产环境

可从 `.env.example` 复制部署相关配置：

```dotenv
YZWC_DEPLOY_TOKEN=replace-with-at-least-32-random-characters
YZWC_DEPLOY_ROOT=/srv/youzai-world-api
# YZWC_DEPLOY_RESTART_COMMAND=pm2 restart YouzaiWorldApi
```

- `YZWC_DEPLOY_ROOT` 是包含 `.output` 与持久化 `server/data` 的生产根目录；未配置时使用进程工作目录。生产服务的工作目录也应指向该根目录，否则数据库与上传文件会落到别处。
- Nitro 生产进程不会自动读取项目根目录的 `.env`；请把这些变量注入 systemd、PM2 或容器的进程环境后再启动服务。
- 未配置 `YZWC_DEPLOY_RESTART_COMMAND` 时，接口返回成功约 1.5 秒后进程以退出码 0 退出，应由 systemd、PM2 或容器自动拉起。systemd 需使用 `Restart=always`，不能只用 `Restart=on-failure`。
- 配置了 `YZWC_DEPLOY_RESTART_COMMAND` 时，服务会在成功响应后从部署根目录异步执行该命令；该命令必须确实能重启当前实例。
- 部署只替换 `.output`，不会改动 `server/data`、环境变量或其他生产文件。更新前的产物保留在 `.deploy/previous-output`，只保留最近一版；需要回滚时先停止服务，再将它恢复为 `.output` 后重新启动。

部署端点使用常量时间比较验证 `X-Deploy-Token`，并拒绝空包、CRC 错误、绝对路径、路径穿越、符号链接、重复路径和超额归档。zip 根目录必须直接包含 Nitro 运行入口 `server/index.mjs`，不能额外套一层 `.output/` 目录；其他文件（例如 `public/`、`nitro.json`）由 `pnpm run build` 自动生成并随包上传。解压后上限为 512 MiB、条目上限为 20,000；同一时间只允许一个部署任务。只有产物完成暂存和校验后才交换目录，交换失败会尝试恢复原 `.output`。

Actions 页面中的 Release Deploy 任务全部成功，才表示部署包已替换且重启后的公开 API 已恢复响应。若失败，按 HTTP 状态排查：`400` 表示 zip 损坏、路径或产物结构不合规，`401` 表示令牌不一致，`409` 表示已有部署任务，`411` 表示反向代理移除了 `Content-Length`，`413` 表示压缩包过大，`415` 表示上传类型不是 zip，`503` 表示生产环境没有配置有效令牌；其他 `500` 表示暂存或目录交换等服务器内部错误。上传成功但最后的健康检查失败，通常表示进程守护服务没有重新拉起 API，或新版本启动失败。

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
