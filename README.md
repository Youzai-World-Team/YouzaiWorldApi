# YouzaiWorldApi — 悠哉世界 API 管理后台

<p align="center">
  <a href="https://github.com/Youzai-World-Team"><img src="https://img.shields.io/badge/Organization-Youzai_World_Team-blue?style=for-the-badge&logo=github" alt="Organization"></a>
  <a><img src="https://img.shields.io/badge/Framework-Nuxt_4-00DC82?style=for-the-badge&logo=nuxt" alt="Nuxt 4"></a>
  <a><img src="https://img.shields.io/badge/Node.js-22+-339933?style=for-the-badge&logo=nodedotjs" alt="Node.js"></a>
  <a><img src="https://img.shields.io/badge/Database-SQLite-003B57?style=for-the-badge&logo=sqlite" alt="SQLite"></a>
  <a><img src="https://img.shields.io/badge/License-Apache_2.0-green?style=for-the-badge" alt="License"></a>
</p>

<div align="center">

#### **简体中文** | [**English**](README.EN.md)

</div>

## 📖 项目概述

**YouzaiWorldApi** 是悠哉世界（Youzai World）Minecraft 多人服务器的集中式后端，基于 **Nuxt 4** 全栈开发（Vue 3 管理后台 + Nitro 服务端 API），数据落在本地 **SQLite**（`node:sqlite`，零外部数据库依赖）。它同时服务四类调用方：

- **服务器管理员**：通过隐藏入口访问管理后台，管理后台用户与权限、游戏账户、玩家称号、皮肤披风、服内邮件、域名邮箱、MCSManager 服务器实例，以及官网的动态 / 捐赠 / 封禁 / 更新 / 下载 / 聊天区内容；
- **[YouzaiWorldCore](https://github.com/Youzai-World-Team/YouzaiWorldCore) 模组**：Minecraft 服务端经 HMAC-SHA256 签名调用 `/api/game/*`，完成离线服账户注册/登录/注销、邮箱验证、密码重置、皮肤披风上传同步、称号同步、游戏邮件收发与附件领取；
- **官网（mcyzw.top）**：公开读取动态、捐赠、封禁、更新与下载信息，聊天区支持访客（Turnstile 人机验证）与游戏玩家（账户登录）发言；
- **CI（GitHub Actions）**：发布 Release 后自动构建并将产物投递到 `/api/deploy`，服务端原子替换 `.output` 完成自动部署。

### 目标用户群体

| 用户类型 | 说明 |
| -------- | ---- |
| **服务器管理员** | 管理后台 19 个页面（按 hidden / view / edit 三级授权），含服务器电源、控制台与文件管理 |
| **生存玩家** | 通过模组内的注册 / 登录 / 邮件 / 称号 / 外观功能间接受益；官网聊天区以玩家身份发言 |
| **Web 开发者** | 了解全栈架构、扩展接口或贡献代码 |

> **技术说明**：本项目为纯服务端渲染 + API 应用（非静态站点），生产运行 `.output/server/index.mjs`；运行期数据（SQLite 数据库与上传文件）全部保存在 `server/data/`，部署更新不会触碰数据。

---

## ✨ 功能介绍

### 1. 管理后台与访问安全

- **隐藏登录入口**：后台登录页位于自定义的 `/<entry>` 隐藏路径（12–64 位随机字符，保留字不可用），其余所有路径对未登录访问一律返回 404，不暴露后台存在性
- **首次初始化（OOBE）**：首次访问根路径进入引导流程，完成所有者账户、登录入口与游戏 API 密钥设置；支持 `YZWC_ADMIN_USERNAME/PASSWORD/ENTRY` 无人值守初始化
- **Cloudflare Turnstile**：登录页人机验证，站点密钥 / 服务端密钥 / 允许域名均可在后台配置（聊天区另有一套独立凭据）
- **单设备会话与挤下线确认**：新登录自动注销旧会话；被挤下线方可凭 2 分钟内有效的 takeover 令牌确认接管
- **登录限流**：同 IP 15 分钟内失败 5 次锁定（后台与聊天区各自独立计数）
- **密码策略**：12–128 位 + 六级强度评分下限（前后端同源校验）、可配置有效期（到期强制改密）、最近 3 次历史防重用
- **审计日志**：全部成功写操作自动记录（用户 / 动作 / 方法 / 路径 / IP / 时间），保留最近 5000 条；另有登录历史（含浏览器 / OS / 设备指纹）与在线后台成员状态
- **安全响应头**：CSP、HSTS、X-Frame-Options DENY、nosniff、Referrer-Policy、Permissions-Policy；`robots` 全量 noindex

### 2. 后台用户与权限体系

- **两级权限模型**：19 个页面 × `hidden / view / edit`，页面之下再细分功能键（如「聊天区：发布消息」「聊天区：管理消息」「账户：修改头像」），功能权限等级受所属页面封顶
- **初始所有者**：拥有全部权限且不可被停用、删除或降权；「后台用户」「权限管理」两页默认对非所有者隐藏
- **个性化导航**：侧边栏页面可按用户排序 / 隐藏，偏好随账户保存
- **危险页面默认收敛**：「服务器管理」默认仅查看（可停服、发命令），「服务器文件」默认整页隐藏（可读写实例目录任意文件）

### 3. 游戏账户服务（`/api/game/*`，HMAC 签名）

为离线模式 Minecraft 服务器提供完整账户体系，供 YouzaiWorldCore 模组调用：

- **注册 / 登录 / 注销 / 删除**：密码使用 PBKDF2-HMAC-SHA256 加盐哈希；可选「注册需邮箱验证」（验证码 10 分钟有效、60 秒重发冷却、5 次尝试上限）
- **邮箱体系**：绑定唯一邮箱（数据库唯一索引保证）、验证码换绑邮箱、邮箱验证重置密码
- **游戏会话令牌**：默认 12 小时（最长 24 小时，`YZWC_GAME_SESSION_TTL_SECONDS` 可调），断线即失效
- **正版档案缓存**：按玩家代号查询 Mojang 档案（结果缓存 6 小时、失败缓存 5 分钟、令牌桶限流 150 次 / 10 分钟），并代理拉取官方皮肤材质；`YZWC_MOJANG_DISABLED=1` 可关闭全部外呼
- **皮肤 / 披风存储**：以 UUID + 槽位为键存 PNG 二进制与 SHA-256 校验，支持整包快照替换，供模组同步给在线玩家

### 4. 玩家称号系统

- 称号目录支持**文字 / 贴图 / 文字 + 贴图组合**三种渲染（贴图经 `youzaiworldcore:title` 位图字体），可配置颜色、加粗、斜体、排序、启停
- 玩家授权三种来源相互独立：**注册**（新账户由数据库触发器自动发放并佩戴「萌新求饶」，不回填老账户）、**手动**（后台给予 / 回收）、**权限**（管理员等级称号，由模组侧按权限同步）
- 佩戴状态由玩家在游戏内切换，后台可强制修改；全量快照供模组周期同步（每 60 秒）

### 5. 服内邮件（游戏邮件）

- 面向游戏玩家的站内信：支持按玩家 / 范围群发、富文本正文、物品附件（由模组侧序列化）、过期时间、隐藏与置顶
- 玩家侧（经模组）：收件箱列表、未读数批量查询、已读 / 星标、附件领取、发件箱、清空邮箱
- 后台侧：邮件列表 / 详情（含每个收件人的已读 / 领取状态）、编辑（已领取内容锁定）、删除；账户注销 / 删除时自动清空其信箱

### 6. 域名邮件（`@mcyzw.top`）

- **收件**：Cloudflare Email Routing 经 Email Worker 解析 MIME 后以独立密钥签名投递到 `/api/inbound-mail`，服务端做「不信任上游」的边界校验（体积、条数、编码、附件预算）后落库；收件保留最近 2000 封，超限按时间淘汰
- **发件**：后台可视化 HTML 编辑器（模板 + 占位符 + 附件）、发送前预览、EML 导出、附件下载；发送走**原生 SMTP 客户端**（`server/utils/smtp.ts`，支持 none / STARTTLS / TLS）
- **已读管理**：按后台用户记录已读状态，侧边栏实时未读计数
- **投递密钥独立于游戏 API 密钥**：Email Worker 被攻破也只能写入收件，碰不到 `/api/game/*`

### 7. 服务器管理（MCSManager 网关）

- **实例控制**：实例列表与状态、开机 / 关机 / 重启 / 终止；所有操作先校验 uuid / daemonId 确属配置的 ApiKey 名下实例，防越权
- **控制台**：实时流（SSE 风格分块拉取）+ 历史日志（按字符数截取末尾，避免整份数十万字符卡死页面）+ 命令下发
- **文件管理**：目录浏览、读写文本（Monaco 编辑器）、重命名、删除、创建、打包 / 解压、**128 KiB 分块上传**（大文件友好）、原图预览（含 docx / Markdown / 表格）
- **备份**：统一存放实例 `/backups` 目录，列表 / 创建（限定文件名模式）/ 恢复 / 删除 / 下载
- **配置**：server.properties 可视化编辑、计划任务管理、实例信息查看
- ApiKey 等价于面板账户全部权限，**只在服务端使用、后台只回报「是否已配置」不回显明文**

### 8. 官网内容与聊天区

| 接口 | 说明 |
| ---- | ---- |
| `/api/activities` | 服务器动态（类型 / 日期 / 内容），后台增删改 |
| `/api/donors` | 捐赠列表（头像 / 昵称 / 简介 / 金额），后台增删改 |
| `/api/bans` | 封禁列表（玩家 / 封禁时间 / 解封时间 / 原因），后台增删改 |
| `/api/updates` + `/api/update/[key]` | 更新服务：按 key 查询最新版本、类型、强制更新标记、发布日期与更新日志，**供模组 / 整合包更新检查器调用** |
| `/api/downloads` | 下载项目（整合包 / 模组，名称 / 地址 / 版本 / 描述），后台增删改 |
| `/api/chat*` | 官网聊天区：访客经 Turnstile 发言（昵称 2–16 位、内容 2–200 字、5 条 / 分钟限流、保留最近 500 条）；游戏玩家凭账户登录发言（角色标记 + 头像）；后台账户可管理 / 删除 / 清空；IP 归属地按哈希缓存 7 天 |

### 9. 自动部署

- 发布 GitHub Release 后 CI 自动：`pnpm install --frozen-lockfile` → `pnpm build` → 压缩 `.output` → `POST /api/deploy`（`X-Deploy-Token`，timingSafeEqual 比对）
- 服务端对部署包做**完整安全校验**：拒绝路径穿越、符号链接、重复路径、CRC32 损坏，限制 100 MiB 压缩 / 512 MiB 解压 / 20000 条目；校验通过后**原子交换 `.output`**（保留上一版可回滚），部署锁防并发
- 部署完成后进程退出，由 systemd / PM2 / Docker 自动重启策略拉起新版本；也可配置 `YZWC_DEPLOY_RESTART_COMMAND`
- **数据永不触碰**：`server/data/`（SQLite + 上传文件）不在替换范围内

### 10. 界面体验

- **Material Web Components**（`@material/web`）+ 深色 / 浅色 / 跟随系统主题切换（带过渡动画）
- **PWA**：manifest + 图标 + 客户端注册，可安装为独立应用
- **页面过渡动画**、全局 Toast、统一确认对话框、自定义滚动条
- **skinview3d** 3D 皮肤 / 披风实时预览（支持宽 / 细模型）、**Monaco Editor** 代码编辑、mammoth / marked / xlsx 文件预览

---

## 🔐 模组对接：HMAC 签名规范

YouzaiWorldCore 模组（Minecraft 服务端）调用 `/api/game/*` 时必须携带签名头：

| 请求头 | 要求 |
| ------ | ---- |
| `x-yzwc-timestamp` | 10 位以上 Unix 秒，与服务端时钟偏差 ≤ 300 秒 |
| `x-yzwc-nonce` | 16–128 位随机串，10 分钟内不可重复（防重放） |
| `x-yzwc-signature` | 64 位十六进制 HMAC-SHA256 |

**规范串**：`{timestamp}.{nonce}.{METHOD}.{path}.{sha256(body)}`（path 含查询串；GET 的 body 为空串的 SHA-256）。密钥为后台「站点设置」页配置的游戏 API 密钥（32–512 位），环境变量 `YZWC_GAME_API_KEY` 仅作兼容回退。请求体上限 3 MiB。

---

## 🚀 部署

### 环境要求

- Node.js **22+**（`node:sqlite` 要求）
- pnpm 10+（CI 使用 `pnpm/action-setup`）
- 无需外部数据库 / Redis：SQLite 文件位于 `server/data/database.db`，首次启动自动建表与迁移

### 本地运行

```bash
pnpm install
pnpm build     # 静态验证
pnpm preview --port 3800   # 本地预览构建产物
```

> 开发服务器 `pnpm dev` 默认监听 `127.0.0.1:3800`（见 `nuxt.config.ts`）。

### 生产部署

1. 准备进程管理器（systemd / PM2 / Docker），工作目录若不在项目根目录，设置 `YZWC_DATA_DIR`（或 `YZWC_DEPLOY_ROOT`）指向数据所在根；
2. 在仓库 Secrets 配置 `DEPLOY_TOKEN` 与 `DEPLOY_URL`；
3. 发布 GitHub Release，CI 自动完成构建、投递与重启验证；
4. 首次启动后访问根路径完成 OOBE 初始化。

### 环境变量一览

完整逐项注释见 [`.env.example`](./.env.example)，要点如下：

| 变量 | 用途 | 默认 |
| ---- | ---- | ---- |
| `YZWC_GAME_API_KEY` | 模组调用 `/api/game/*` 的签名密钥（推荐在后台配置） | 无（未配置时游戏接口 503） |
| `YZWC_DEPLOY_TOKEN` | CI 自动部署令牌，须与 Actions Secret 一致 | 无（未配置时部署接口拒绝） |
| `YZWC_DEPLOY_ROOT` / `YZWC_DEPLOY_RESTART_COMMAND` | 部署根目录 / 重启命令 | 进程工作目录 / 退出由进程管理器拉起 |
| `YZWC_INBOUND_MAIL_KEY` | Email Worker 投递收件的签名密钥（独立于游戏密钥） | 无（未配置时收件接口 503） |
| `YZWC_REPLY_TEMPLATE_PATH` | 域名邮件回复模板路径 | 工作目录下 `reply.html` |
| `YZWC_MCSM_BASE_URL` / `YZWC_MCSM_API_KEY` | MCSManager 面板地址与 ApiKey | 无（未配置时「服务器管理」页提示去设置） |
| `NUXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` / `TURNSTILE_HOSTNAMES` | 后台登录 Turnstile | 无 |
| `TURNSTILE_CHAT_SITE_KEY` / `TURNSTILE_CHAT_SECRET` / `TURNSTILE_CHAT_HOSTNAMES` | 官网聊天区 Turnstile（未配置时回退后台那套） | 无 |
| `YZWC_IP_GEO_DISABLED` / `YZWC_MOJANG_DISABLED` | 关闭 IP 归属地 / Mojang 外呼 | 未设置即开启外呼 |
| `YZWC_ADMIN_USERNAME` / `YZWC_ADMIN_PASSWORD` / `YZWC_ADMIN_ENTRY` | 无人值守 OOBE 初始化 | 无（走页面引导） |
| `YZWC_GAME_SESSION_TTL_SECONDS` | 游戏会话时长 | 43200（12 小时，上限 24 小时） |

> 生产环境运行时不会读取 `.env`（仅开发兼容），密钥类配置请优先保存在后台「站点设置」页（写入数据库 `settings` 表，优先级高于环境变量）。

---

## 📁 项目结构

```
YouzaiWorldApi/
├── nuxt.config.ts          # devServer 3800、nitro 错误处理、md-* 自定义元素、PWA meta
├── .github/workflows/release.yml   # Release → 构建 → 投递 /api/deploy 的自动部署流水线
├── app/                    # 管理后台前端
│   ├── pages/              # 22 个路由（仪表盘 / 隐藏登录 / 账户 / 19 个管理页）
│   ├── components/         # OOBE、确认框、Toast、Monaco 编辑器、皮肤预览等 15+ 组件
│   ├── composables/        # 会话权限 / 隐藏入口 / 主题 / Toast 等组合式函数
│   └── middleware/auth.global.ts   # 前端路由守卫
├── server/
│   ├── api/                # 174 个接口：auth/ admin/ game/ inbound-mail deploy update/* 公开内容
│   ├── middleware/         # 安全响应头、HMAC 鉴权、入口守卫、API 页面权限
│   ├── plugins/            # 启动迁移 + 审计日志钩子
│   ├── utils/              # db.ts（核心）+ MCSM / SMTP / 邮件 / Mojang / 部署等 24 个模块
│   └── data/               # 运行期数据（gitignore）：database.db、uploads/
├── shared/                 # 前后端共享：页面权限模型、API 权限映射、密码策略、设备识别
└── public/                 # PWA 图标与静态资源
```

---

## 🤝 关联项目

- **[YouzaiWorldCore](https://github.com/Youzai-World-Team/YouzaiWorldCore)** — 悠哉世界核心模组（Fabric，MC Java 26.2），本服务 `/api/game/*` 的唯一签名调用方
- **[YouzaiWorldWebNew](https://mcyzw.top)** — 官网，消费本服务的公开内容接口与聊天区

---

## 📄 许可证

本项目采用 [Apache-2.0](./LICENSE) 许可证。
