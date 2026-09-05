# AGENTS.md — YouzaiWorldApi AI 开发助手上下文

> 本文件为 AI 开发助手（Claude Code / Copilot / Cursor 等）提供快速理解本项目所需的集中上下文。
> 面向人类的完整功能说明见 [README.md](./README.md)（中文）与 [README.EN.md](./README.EN.md)（英文）。

---

## 1. 项目概述

| 项目 | 说明 |
|------|------|
| 名称 | **YouzaiWorldApi（悠哉世界 API 管理后台）** |
| 类型 | **Nuxt 4 全栈应用**：管理后台前端（Vue 3 + Material Web）+ Nitro 服务端 API |
| 目标 | 为「悠哉世界」Minecraft 多人服务器提供账户认证、邮件、称号、外观、内容管理、服务器面板网关等集中式后端能力，同时作为管理后台与官网的数据接口 |
| 仓库 | https://github.com/Youzai-World-Team/YouzaiWorldApi |
| 关联项目 | [YouzaiWorldCore](https://github.com/Youzai-World-Team/YouzaiWorldCore)（Fabric 模组，通过 HMAC 签名调用本服务的 `/api/game/*` 接口） |
| 官网 | https://mcyzw.top（后台预计运行在 https://api.mcyzw.top） |
| 许可证 | Apache-2.0 |

**主要功能域**：

- **管理后台**：隐藏入口登录（自定义 12–64 位路径）、Cloudflare Turnstile 人机验证、单设备会话与挤下线确认、页面/功能两级权限、后台用户与密码策略（复杂度 + 有效期 + 历史防重用）、审计日志、OOBE 首次初始化
- **游戏账户服务**：离线服账户注册/登录/注销、PBKDF2-HMAC-SHA256 密码哈希、邮箱验证注册、邮箱换绑、密码重置、游戏会话令牌、Mojang 正版档案缓存与材质代理、皮肤/披风二进制存储
- **服内邮件**：面向游戏内玩家的邮件系统（发送、收件、领取附件、星标、隐藏、过期清理），供模组读写
- **称号系统**：称号目录（文字/贴图/组合三种渲染）、玩家授权（注册/手动/权限三种来源）、佩戴状态，供模组同步
- **域名邮件**：`@mcyzw.top` 收件（Cloudflare Email Worker 投递）+ 后台 HTML 编写/预览/发送/附件/EML 导出
- **服务器管理**：MCSManager 面板网关（实例电源、控制台流、命令、文件管理、分块上传、备份、server.properties、计划任务）
- **官网内容接口**：服务器动态、捐赠列表、封禁列表、更新服务（`/api/update/[key]`，供模组/整合包更新检查器调用）、下载项目、带 Turnstile 与玩家登录的官网聊天区
- **自动部署**：GitHub Release → Actions 构建 → `POST /api/deploy`（令牌校验 + zip 安全检查 + 原子替换 `.output`）

**目标用户**：服务器运维/管理员（后台各页面）、官网访客（公开接口）、YouzaiWorldCore 模组（签名 API 调用方）、参与开发的 Web 开发者。

---

## 2. 技术栈

| 依赖 | 版本 | 来源 / 用途 |
|------|------|------------|
| Nuxt | **^4.5.2**（`type: module`） | 全栈框架：`app/` 前端 + `server/` Nitro API |
| Vue | ^3.5.41 | 前端框架 |
| Node.js | **22**（CI 固定；本地需 22+，`node:sqlite` 需要） | 运行时 |
| pnpm | 10.32.1（`packageManager` 字段；仓库另有 `bun.lock` 历史文件） | 包管理 |
| node:sqlite | 内置 `DatabaseSync` | 唯一持久化：`server/data/database.db`，**无 ORM、无第三方数据库驱动** |
| @material/web | ^2.5.0 | Material Web Components（`md-*` 自定义元素，已在 `nuxt.config.ts` 声明 `isCustomElement`） |
| jszip | ^3.10.1 | 部署 zip 解包（`server/utils/deploy.ts`） |
| mammoth / marked / xlsx | 各最新 | 文件预览：docx → HTML、Markdown 渲染、表格预览 |
| monaco-editor | 0.52.2 | 「服务器文件」页代码编辑器 |
| skinview3d | 3.4.1 | 「账户装扮」页 3D 皮肤预览 |
| vue-router | ^5.2.0 | 路由（Nuxt 内置配套） |

- **无 TypeScript 检查脚本**（未配置 `typecheck`/`lint` script），验证以 `pnpm build` 的静态验证为准。
- **无测试框架**，无自动化测试。
- 运行期零外部服务强依赖：SQLite 本地文件 + 少量外呼（MCSManager、Mojang、Turnstile、SMTP、IP 归属地、节点监控）均可按需关闭。

---

## 3. 项目结构

```
YouzaiWorldApi/
├── nuxt.config.ts                    # devServer 127.0.0.1:3800；nitro.errorHandler；md-* 自定义元素；PWA meta；CSP 由中间件下发
├── package.json                      # scripts: build / dev / generate / preview(3800) / postinstall(nuxt prepare)
├── pnpm-lock.yaml / pnpm-workspace.yaml / bun.lock
├── .env.example                      # ⭐ 全部环境变量的权威注释（密钥、部署、Turnstile、MCSM、开关类变量）
├── .github/workflows/release.yml     # CI：Release 发布 → pnpm build → zip .output → POST /api/deploy → 验证重启
├── README.md / README.EN.md / AGENTS.md
│
├── app/                              # ─── Nuxt 前端（管理后台） ───
│   ├── app.vue / layouts/default.vue # 侧边栏 + 顶栏布局（导航按权限渲染、可排序/隐藏）
│   ├── assets/css/main.css           # 全局样式
│   ├── components/                   # AdminSetup(OOBE)、ConfirmDialog、AppToast、CodeEditor(Monaco)、
│   │                                 #   FilePreview、SkinFigure/SkinModelViewer(skinview3d)、ServerProperties、
│   │                                 #   ServerSchedules、PasswordStrength、AdminPasswordDialog、AppScrollbar、
│   │                                 #   AppLoadingBar、DeviceClientIcon、DashboardPermissionPlaceholder
│   ├── composables/                  # useAdminAccess(会话与权限)、useEntry(隐藏入口)、useToast、
│   │                                 #   useThemeTransition(深色模式)、usePasswordPolicy、useDomainMailUnread、
│   │                                 #   useDialogAnimation、useEntry
│   ├── middleware/auth.global.ts     # ⭐ 前端路由守卫：OOBE 检查 → 登录态 → 密码过期强制改密 → 页面权限 hidden 重定向
│   ├── pages/                        # 22 个路由：index(仪表盘)、[entry](隐藏登录页)、account、activity、status、
│   │                                 #   chat、donors、bans、updates、downloads、game-accounts、
│   │                                 #   game-account-email-templates(归 game-accounts 权限)、game-cosmetics、
│   │                                 #   game-titles、mail、domain-mail、server-manage、server-files/{index,preview}、
│   │                                 #   admin-users、audit-logs、permissions、settings
│   ├── plugins/                      # material-web.client.ts（md-* 组件按需导入）、pwa.client.ts（PWA 注册）
│   ├── types/turnstile.d.ts
│   └── utils/skin-layout.ts          # 皮肤贴图布局计算（配合 skinview3d）
│
├── server/                           # ─── Nitro 服务端 ───
│   ├── api/                          # ⭐ 174 个接口文件，按前缀分四类：
│   │   ├── auth/                     # 后台会话与自助：login/logout/me/setup/entry、devices、logins、avatar、
│   │   │                             #   full-name、password(-policy/-expiry)、game-api-key、inbound-mail-key、
│   │   │                             #   presence、navigation、turnstile、app-info
│   │   ├── admin/                    # 后台管理（requireAuth + 页面/功能权限）：users、permissions、audit-logs、
│   │   │                             #   status、chat、game-accounts(+settings/uuid/email-preview)、game-cosmetics、
│   │   │                             #   game-titles、mails(服内邮件)、domain-mails(域名邮件)、mcsm-settings、
│   │   │                             #   mcsm/{instance,instances,power,command,log,stream,files*,file,backup*,
│   │   │                             #   properties,schedules}、password-policy/-expiry、turnstile
│   │   ├── game/                     # ⭐ 模组专用（HMAC 签名中间件保护）：account(增删改查/ensure)、login/logout、
│   │   │                             #   session、change-password、account-email(验证/换绑)、account-password-reset、
│   │   │                             #   cosmetic(上传/快照)、titles(equip/sync)、mail(inbox/send/claim/read/…)、
│   │   │                             #   account-settings、deactivate
│   │   ├── inbound-mail.post.ts      # Cloudflare Email Worker 投递收件（独立密钥签名）
│   │   ├── deploy.post.ts            # CI 自动部署入口（X-Deploy-Token）
│   │   ├── update/[key].get.ts       # ⭐ 模组/整合包更新检查器入口（公开，按 key 查询）
│   │   └── activities/donors/bans/updates/downloads/chat/upload(+uploads/[name])/domain-mail-logo
│   │                                 # 官网公开内容接口（读公开、写需后台权限；chat 带 Turnstile 与玩家登录）
│   ├── middleware/                   # security.ts(响应头/CSP/Origin/体积上限)、game-api-auth.ts(HMAC)、
│   │                                 #   inbound-mail-auth.ts、entry-guard.ts(SSR 页面路由：未登录只放行 /<entry>)、
│   │                                 #   admin-page-permissions.ts(API 页面权限)、cors.ts
│   ├── plugins/                      # init.ts(启动迁移 + 运行时安全配置校验)、audit.ts(afterResponse 写审计日志)
│   ├── utils/                        # db.ts(⭐ 5498 行核心：全部表结构、迁移、鉴权、各业务域函数)、
│   │                                 #   data-dir.ts(数据目录解析)、deploy.ts(zip 安全校验+原子交换+重启)、
│   │                                 #   mcsm*.ts(面板客户端/文件/控制台流/上传/备份)、smtp*.ts(原生 SMTP 客户端与报文)、
│   │                                 #   email-template*.ts(验证邮件模板)、domain-mail*.ts(编写/发送/HTML/附件)、
│   │                                 #   eml.ts(EML 导出)、mojang.ts(档案查询+材质代理+限流)、turnstile.ts、
│   │                                 #   ip-location.ts、status.ts(节点与 MC 服务器状态)、html-sanitize.ts、
│   │                                 #   game-input.ts(玩家代号/UUID/邮箱/位置校验)、client-device.ts(UA 解析)
│   ├── error-handler.ts              # nitro.errorHandler 统一错误响应（JSON，页面 404 由 entry-guard 定制）
│   └── data/                         # 运行期数据（已 gitignore）：database.db、uploads/
│
├── shared/                           # ⭐ 前后端共享（#shared 别名引入）
│   ├── admin-page-permissions.ts     # 19 个后台页面定义 + 路由映射 + 功能权限定义 + 导航偏好
│   ├── admin-api-permissions.ts      # API 路径 → 页面键映射（权限中间件用）
│   ├── password-policy.ts            # 密码强度评分/策略/过期计算（前后端同源）
│   └── client-device.ts              # 浏览器/OS/设备识别（前后端同源）
│
└── public/                           # 必须同源的 manifest.webmanifest、Service Worker 与 robots.txt；图片/图标由 assets.mcyzw.top 托管
```

**入口与初始化时序**：

```
Nitro 启动
 ├─ server/utils/db.ts 顶层副作用      # ensureDataDirs() + 打开 SQLite + 全部 CREATE TABLE IF NOT EXISTS + 列迁移
 ├─ plugins/init.ts                    # migrateFromJson()（旧 JSON 数据迁移）+ validateRuntimeSecurityConfig()
 ├─ plugins/audit.ts                   # 挂 afterResponse 钩子：成功的写操作写 audit_logs
 └─ 中间件顺序（每个请求）：security → game-api-auth / inbound-mail-auth → admin-page-permissions / entry-guard
```

---

## 4. 开发规范

### 4.1 验证方式（重要约定）

- **验证改动只需静态验证**：运行 `pnpm build`（即 `nuxt build`）确认可构建、类型无误即可，**不需要也不应该启动开发服务器**（`pnpm dev`）做运行时验证；运行时行为由开发者本人在环境中确认。
- 项目没有配置 lint / typecheck / test 脚本，`pnpm build` 是唯一的静态验证关卡。

### 4.2 代码风格

- TypeScript 严格风格；**注释与用户可见文案一律中文**；错误信息用 `createError({ statusCode, statusMessage })` 抛出（statusMessage 中文）。
- 服务端业务函数大量写在 `server/utils/db.ts`，API 路由文件只做「鉴权 → 取参 → 调函数 → 返回」的薄壳。
- 前后端共享的类型与纯函数放 `shared/`，通过 `#shared/...` 别名引入，**不要在 `shared/` 里引用 node 或浏览器专属 API**。
- 常量（正则、上限、TTL）一律定义在文件顶部具名常量，集中分节注释（`// ===== 分节 =====`）。
- 权限相关：新增后台页面必须同步登记 `shared/admin-page-permissions.ts`（页面定义 + 导航顺序 + 路由映射）与 `shared/admin-api-permissions.ts`（API 前缀 → 页面键），否则权限中间件认不出来。

### 4.3 数据库规范（强制）

- **唯一入口** `server/utils/db.ts`：所有表结构、索引、触发器、迁移、业务查询都在此文件；新增表在顶部 `db.exec` 建表块中追加 `CREATE TABLE IF NOT EXISTS`。
- **列迁移模式**：先 `PRAGMA table_info(<table>)` 检查列是否存在，再 `ALTER TABLE ADD COLUMN`，catch 中复查以兼容多进程同时启动。
- SQLite 为同步 API（`db.prepare(...).all/get/run`），**不要引入异步数据库驱动**。
- 运行期数据（`server/data/database.db`、`server/data/uploads/`）已 gitignore，**绝不提交**；数据库路径由 `server/utils/data-dir.ts` 解析（`YZWC_DATA_DIR` 可覆盖）。
- 敏感配置（密钥、SMTP、Turnstile、MCSM）存 `settings` 表（`getSetting`/`setSetting`），**优先级：数据库 > 环境变量**；密钥类字段接口只回显「是否已配置」，不回传明文。

### 4.4 鉴权规范（强制）

| 接口前缀 | 鉴权方式 | 实现位置 |
|----------|----------|----------|
| `/api/auth/*`、`/api/admin/*` | 会话 Cookie `__Host-yzwc_admin`（或 `Authorization: Bearer`），`requireAuth` / `requirePagePermission` / `requireFeaturePermission` / `requireOwner` | `server/utils/db.ts` + `server/middleware/admin-page-permissions.ts` |
| `/api/game/*` | **HMAC-SHA256 签名**：头 `x-yzwc-timestamp`（±300s）、`x-yzwc-nonce`（16–128 位、10 分钟防重放）、`x-yzwc-signature`；规范串 `timestamp.nonce.METHOD.path.sha256(body)`；请求体上限 3 MiB | `server/middleware/game-api-auth.ts` → `verifySignedRequest` |
| `/api/inbound-mail` | 同一套签名规范，**独立密钥**（`inbound_mail.key` / `YZWC_INBOUND_MAIL_KEY`） | `server/middleware/inbound-mail-auth.ts` |
| `/api/deploy` | `X-Deploy-Token` 头，timingSafeEqual 比对 | `server/utils/deploy.ts` |
| 公开读接口（activities/donors/bans/updates/downloads/chat 读） | 无鉴权（供官网与更新检查器读取）；写操作走后台权限 | 各路由文件 |

- 修改 `/api/game/*` 的请求形态时，**必须同步核对 YouzaiWorldCore 模组侧 `api/ApiHttp` 的签名实现**，两边规范串一致才能通过校验。
- 会话模型为**单设备**：新登录会删除该用户旧会话；被挤下线方需 2 分钟内用 takeover token 确认。
- 新增后台接口记得确认它在 `shared/admin-api-permissions.ts` 中的页面归属，避免越权或误拦。

### 4.5 安全红线

- 一切外呼（MCSM、Mojang、Turnstile siteverify、SMTP、IP 归属地、监控）只在服务端发起，浏览器只与本服务通信。
- 信任源白名单：`https://mcyzw.top` / `www` / `api`（`server/middleware/security.ts`），改动域名需同步 CSP。
- 用户内容（邮件 HTML、聊天、文件预览）必须经 `server/utils/html-sanitize.ts` 白名单净化后落库/回显。
- 上传与部署包有严格校验：部署 zip 拒绝路径穿越、符号链接、重复路径、CRC32 不符、超限（100 MiB 压缩 / 512 MiB 解压 / 20000 条目），新增类似能力请复用 `deploy.ts` 的检查模式。

### 4.6 提交与分支

- **主分支 `master`**，直接在 `master` 上开发并推送。
- **提交信息为中文**，惯用形式：`**功能：<描述>**`、`修复：<描述>`；一次提交聚焦一个功能点。
- `server/data/`、`.env`、`.output/`、`.deploy/`、`.nuxt/`、`node_modules/`、`.workbuddy/` 均已 gitignore，勿提交。

---

## 5. 常用命令

> 包管理用 pnpm；Node 需要 22+。**验证改动只需执行静态验证 `pnpm build`，不要启动开发服务器。**

| 命令 | 说明 |
|------|------|
| `pnpm install` | 安装依赖（自动跑 `postinstall: nuxt prepare`） |
| `pnpm build` | ⭐ **静态验证用这个**（`nuxt build`，产物 `.output/`） |
| `pnpm generate` | 静态生成（本项目生产部署不用它，部署走 `build` 产物） |
| `pnpm dev` | 开发服务器（127.0.0.1:3800）——**AI 助手约定不使用**，运行时验证由开发者完成 |
| `pnpm preview --port 3800` | 本地预览构建产物 |

### Git

```bash
git status
git add -A && git commit -m "**功能：<中文描述>**"
git pull --rebase origin master
git push origin master
```

### 生产部署（供参考，不代执行）

GitHub Release 发布 → `release.yml`：`pnpm install --frozen-lockfile` → `pnpm build` → zip `.output` → `POST $DEPLOY_URL/api/deploy`（`X-Deploy-Token`）→ 服务端校验并原子替换 `.output` → 进程退出由 systemd/PM2 拉起新版本（或执行 `YZWC_DEPLOY_RESTART_COMMAND`）。

---

## 6. 架构说明

### 6.1 三类调用方

```
浏览器（管理后台 SPA，api.mcyzw.top）
  → /api/auth/* /api/admin/*        会话 Cookie + 页面/功能权限
官网（mcyzw.top）
  → /api/activities /donors /bans /updates /downloads /chat*   公开读 + 后台写
YouzaiWorldCore 模组（Minecraft 服务端）
  → /api/game/*                     HMAC-SHA256 签名
Cloudflare Email Worker
  → /api/inbound-mail               独立密钥签名
GitHub Actions
  → /api/deploy                     X-Deploy-Token
```

### 6.2 权限模型

- **初始所有者（is_owner=1）**：全部页面 `edit`，不可被停用/删除/降权。
- **普通后台用户**：19 个页面键 × `hidden/view/edit` 三级；页面下再细分功能键（如「聊天区：发布消息」「账户：修改头像」），功能权限等级受所属页面封顶（`maxNonOwnerLevel` + `capFeatureLevelToPage`）。
- 前端 `app/middleware/auth.global.ts` 与服务端 `entry-guard.ts` / `admin-page-permissions.ts` **双重把关**；API 层以服务端为准。
- 页面定义唯一权威：`shared/admin-page-permissions.ts`。

### 6.3 数据落库概览（40 张表）

| 域 | 表 |
|----|----|
| 后台自身 | `settings`、`sessions`、`admin_users`、`admin_page_permissions`、`admin_feature_permissions`、`admin_password_history`、`admin_presence`、`audit_logs`、`login_history`、`admin_login_rate_limits`、`admin_login_takeovers` |
| 游戏账户 | `game_accounts`、`game_sessions`、`game_registration_sessions`、`game_password_reset_sessions`、`game_email_change_sessions`、`mojang_profiles`、`api_request_nonces` |
| 称号 | `game_titles`、`game_player_title_grants`、`game_player_title_selection`（含注册触发器自动发「萌新求饶」） |
| 邮件 | `game_mails`、`game_mail_refs`、`domain_mails`、`domain_mail_attachments`、`domain_mail_reads` |
| 外观 | `game_cosmetics`（uuid+slot 存 BLOB 与 sha256） |
| 官网内容 | `activities`、`donors`、`bans`、`updates`、`downloads`、`chat_messages`、`chat_player_sessions`、`chat_login_rate_limits`、`ip_locations` |

### 6.4 关键设计决策

1. **单一 db.ts 巨石文件**：所有 SQL 与业务函数集中在 `server/utils/db.ts`，API 路由保持薄壳。新增功能优先在此追加函数，而非在路由里内联 SQL。
2. **密钥三轨**：游戏 API 密钥（模组）、收件投递密钥（Email Worker）、部署令牌（CI）三者独立，互不通用；均支持「数据库 settings 优先、环境变量回退」。
3. **启动即迁移**：无版本号迁移框架，全部靠 `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` 列检查幂等完成，新代码可直接跑在旧库上。
4. **限流与配额集中在常量区**：登录 5 次/15 分钟（后台与聊天区各一套）、聊天 5 条/分钟、Mojang 150 次/10 分钟、域名邮件保留 2000 封、审计/登录历史各 5000 条、聊天保留 500 条。
5. **部署不触碰数据**：`/api/deploy` 只原子替换 `.output/`，`server/data/` 永不动；部署锁（`.deploy/deploy.lock`，15 分钟过期）防并发。
6. **外呼均可关**：`YZWC_IP_GEO_DISABLED`、`YZWC_MOJANG_DISABLED` 等开关保证离线环境可运行。

---

## 7. 常见问题

### 环境与运行
- **Node 必须 22+**（`node:sqlite` 与 Nitro 要求）；本地装依赖后 `postinstall` 会自动 `nuxt prepare`。
- **首次访问根路径触发 OOBE**：未初始化时所有页面重定向到 `/`，由 `AdminSetup` 组件完成所有者账户 + 登录入口 + 游戏 API 密钥的初始化；也可用 `YZWC_ADMIN_USERNAME/PASSWORD/ENTRY` 无人值守初始化。
- **登录入口是隐藏路径 `/<entry>`**（12–64 位，`RESERVED_ADMIN_ENTRIES` 保留字不可用）；忘记入口需直接查 `settings` 表 `entry` 键。
- **登录报 429**：同 IP 15 分钟内失败 5 次触发限流，等待或清 `admin_login_rate_limits` 表。

### 开发坑点
- **`pnpm dev` 端口固定 3800**（`nuxt.config.ts` 的 `devServer`），冲突时改配置。
- **改了 `/api/game/*` 却总是 401**：先查时间窗（±300s）、nonce 是否重复、规范串是否与模组侧 `ApiHttp` 完全一致（含 path 带查询串）。
- **新增后台页面「看不见」**：漏登记 `ADMIN_PAGE_DEFINITIONS` / `ADMIN_NAVIGATION_ORDER` / `adminPageKeyForPath` / `pageKeyForApi` 四处之一。
- **`md-*` 组件不渲染**：`nuxt.config.ts` 已按 `isCustomElement` 放行，但组件需在 `app/plugins/material-web.client.ts` 注册导入。
- **`server/data/database.db` 是运行库**：调试时可删（会丢数据），但**绝不能提交**；改动表结构后本地旧库可能需要手工清理或触发列迁移。
- **密钥留空提交**是设计行为（沿用旧值），不是 bug；同理密钥接口不回显明文。
- **跨端共享代码**必须放 `shared/`（`#shared` 别名），在 `app/` 里 import 服务端模块会构建失败，反之亦然。

### 部署
- 生产运行 `.output/server/index.mjs`；数据目录默认按项目根定位，**工作目录不在项目根时必须设 `YZWC_DATA_DIR` 或 `YZWC_DEPLOY_ROOT`**。
- 部署后依赖进程管理器自动重启；没有自动重启策略时配置 `YZWC_DEPLOY_RESTART_COMMAND`。

---

## 8. 参考资料

### 项目内文档
| 文件 | 内容 |
|------|------|
| [README.md](./README.md) | 完整功能清单、部署指南、环境变量表、HMAC 签名规范 |
| [README.EN.md](./README.EN.md) | 上述内容的英文版 |
| `.env.example` | 全部环境变量的逐项权威注释 |
| `.github/workflows/release.yml` | CI 自动部署全流程 |
| `server/utils/db.ts` | 表结构、鉴权、各业务域函数的唯一权威 |
| `shared/admin-page-permissions.ts` | 页面/功能权限模型权威定义 |
| `server/utils/deploy.ts` | 部署包安全校验与原子交换 |

### 外部文档
- Nuxt 4 文档：https://nuxt.com/docs
- Nitro 文档：https://nitro.build/
- node:sqlite：https://nodejs.org/api/sqlite.html
- MCSManager API：https://docs.mcsmanager.com/
- Cloudflare Turnstile：https://developers.cloudflare.com/turnstile/
- Cloudflare Email Workers：https://developers.cloudflare.com/email-routing/email-workers/
- 关联模组 YouzaiWorldCore：https://github.com/Youzai-World-Team/YouzaiWorldCore
- 项目 Issues：https://github.com/Youzai-World-Team/YouzaiWorldApi/issues
