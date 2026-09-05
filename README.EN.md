# YouzaiWorldApi — Youzai World API Administration Backend

<p align="center">
  <a href="https://github.com/Youzai-World-Team"><img src="https://img.shields.io/badge/Organization-Youzai_World_Team-blue?style=for-the-badge&logo=github" alt="Organization"></a>
  <a><img src="https://img.shields.io/badge/Framework-Nuxt_4-00DC82?style=for-the-badge&logo=nuxt" alt="Nuxt 4"></a>
  <a><img src="https://img.shields.io/badge/Node.js-22+-339933?style=for-the-badge&logo=nodedotjs" alt="Node.js"></a>
  <a><img src="https://img.shields.io/badge/Database-SQLite-003B57?style=for-the-badge&logo=sqlite" alt="SQLite"></a>
  <a><img src="https://img.shields.io/badge/License-Apache_2.0-green?style=for-the-badge" alt="License"></a>
</p>

<div align="center">

#### [**简体中文**](README.md) | **English**

</div>

## 📖 Overview

**YouzaiWorldApi** is the centralized backend of the Youzai World Minecraft multiplayer server. It is a full-stack **Nuxt 4** application (Vue 3 admin dashboard + Nitro server API) backed by a local **SQLite** database (`node:sqlite` — no external database dependency). It serves four kinds of callers:

- **Server administrators**: access the admin dashboard through a hidden entry path to manage admin users and permissions, game accounts, player titles, skins and capes, in-game mail, domain mailboxes, MCSManager instances, and the website's activities / donors / bans / updates / downloads / chat content;
- **The [YouzaiWorldCore](https://github.com/Youzai-World-Team/YouzaiWorldCore) mod**: the Minecraft server calls `/api/game/*` with HMAC-SHA256 signatures for offline-mode account registration/login/deletion, e-mail verification, password resets, skin and cape upload/sync, title syncing, and in-game mail with attachment claims;
- **The website (mcyzw.top)**: publicly reads activities, donors, bans, updates and downloads; the chat area supports both guests (behind Cloudflare Turnstile) and game players (account login);
- **CI (GitHub Actions)**: after a Release is published, the build artifact is delivered to `/api/deploy`, where the server atomically swaps `.output` to complete a zero-data-loss deployment.

### Target Users

| User Type | Description |
| --------- | ----------- |
| **Server administrators** | 19 dashboard pages (authorized at hidden / view / edit levels), including server power, console, and file management |
| **Survival players** | Benefit indirectly through the mod's register / login / mail / title / cosmetic features; can speak in the website chat as players |
| **Web developers** | Understand the full-stack architecture, extend the API, or contribute code |

> **Technical note**: This project is a server-rendered application with APIs (not a static site); production runs `.output/server/index.mjs`. All runtime data (the SQLite database and uploaded files) lives under `server/data/` and is never touched by deployments. Dashboard images, icons, and PWA artwork are hosted centrally at `https://assets.mcyzw.top/`; the local `public/` directory only retains the same-origin manifest, Service Worker, and robots.txt.

---

## ✨ Features

### 1. Admin Dashboard & Access Security

- **Hidden login entry**: the login page sits at a custom `/<entry>` path (12–64 random characters, reserved words blocked); every other path returns 404 for unauthenticated visitors, so the dashboard's existence is not exposed
- **First-run OOBE**: the first visit to the root path starts a guided setup for the owner account, login entry, and game API key; unattended initialization is possible via `YZWC_ADMIN_USERNAME/PASSWORD/ENTRY`
- **Cloudflare Turnstile**: login-page bot protection; site key / secret / allowed hostnames are configurable in the dashboard (the chat area uses a separate set of credentials)
- **Single-device sessions & takeover confirmation**: a new login revokes old sessions; the kicked party can confirm takeover with a token valid for 2 minutes
- **Login rate limiting**: 5 failed attempts per IP within 15 minutes locks the IP (separate counters for the dashboard and the chat area)
- **Password policy**: 12–128 characters with a configurable minimum strength score (1–6, validated identically on client and server), optional expiry (forcing a password change when expired), and reuse prevention against the last 3 passwords
- **Audit logs**: every successful write operation is recorded (user / action / method / path / IP / time), retaining the latest 5,000 entries; plus login history (with browser / OS / device fingerprint) and online admin presence
- **Security headers**: CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy; fully `noindex`

### 2. Admin Users & Permission System

- **Two-level permission model**: 19 pages × `hidden / view / edit`, with finer-grained feature keys under each page (e.g. "chat: send messages", "chat: moderate messages", "account: change avatar"); feature levels are capped by their parent page
- **Initial owner**: holds all permissions and cannot be deactivated, deleted, or demoted; the "Admin Users" and "Permissions" pages are hidden from non-owners by default
- **Personalized navigation**: sidebar pages can be reordered / hidden per user, persisted with the account
- **Dangerous pages default to restricted**: "Server Manage" defaults to view-only (it can stop the server and run arbitrary commands), "Server Files" is hidden by default (it can read/write any file in the instance directory)

### 3. Game Account Service (`/api/game/*`, HMAC-signed)

A complete account system for offline-mode Minecraft servers, consumed by the YouzaiWorldCore mod:

- **Register / login / deactivate / delete**: passwords hashed with PBKDF2-HMAC-SHA256 and salt; optional "registration requires e-mail verification" (codes valid 10 minutes, 60-second resend cooldown, max 5 attempts)
- **E-mail system**: unique bound e-mail (enforced by a unique database index), verification-code e-mail changes, e-mail-verified password resets
- **Game session tokens**: 12 hours by default (24-hour maximum, adjustable via `YZWC_GAME_SESSION_TTL_SECONDS`), invalidated on disconnect
- **Mojang profile cache**: lookups by player name (cached 6 hours on success, 5 minutes on failure, rate-limited to 150 lookups / 10 minutes), with official texture proxying; `YZWC_MOJANG_DISABLED=1` disables all outbound calls
- **Skin / cape storage**: PNG binaries keyed by UUID + slot with SHA-256 checksums, supporting full-snapshot replacement for the mod to sync with online players

### 4. Player Title System

- Title catalog supports **text / texture / text + texture** rendering (textures via the `youzaiworldcore:title` bitmap font), with configurable color, bold, italic, sort order, and enable state
- Three independent grant sources: **registration** (new accounts automatically receive and equip "Newbie Plea" via a database trigger — never backfilled to existing accounts), **manual** (granted/revoked from the dashboard), and **permission** (admin-rank titles synced by the mod based on permissions)
- Players switch their equipped title in-game; the dashboard can override it; full snapshots are synced to the mod every 60 seconds

### 5. In-Game Mail

- Player-facing mailbox: broadcast by player / scope, rich text bodies, item attachments (serialized by the mod), expiry times, hiding, and pinning
- Player side (via the mod): inbox listing, batch unread counts, read / starred states, attachment claiming, sent box, mailbox clearing
- Dashboard side: mail list / detail (with per-recipient read / claim status), editing (claimed content is locked), deletion; mailboxes are cleared automatically when an account is deactivated or deleted

### 6. Domain Mail (`@mcyzw.top`)

- **Inbound**: Cloudflare Email Routing delivers via an Email Worker that parses MIME and signs requests with an independent key to `/api/inbound-mail`; the server applies "never trust upstream" boundary checks (sizes, counts, encodings, attachment budgets) before persisting; the latest 2,000 messages are retained
- **Outbound**: a visual HTML composer in the dashboard (templates + placeholders + attachments), pre-send preview, EML export, attachment downloads; sending goes through a **native SMTP client** (`server/utils/smtp.ts`, supporting none / STARTTLS / TLS)
- **Read management**: per-admin read states with a live unread badge in the sidebar
- **Visibility scopes**: each non-owner always retains the mailbox matching their username (for example, `zhangshan@mcyzw.top`); the initial owner can append one or more local-part prefixes per user from the **Permissions** page (prefixes are additive and an empty list adds nothing), and the same scope is enforced for details, attachments, EML/HTML exports, unread counts, and deletion. These additions affect inbound viewing only and never grant a non-owner permission to send as another address
- **The inbound key is independent from the game API key**: a compromised Email Worker can only write incoming mail and can never touch `/api/game/*`

### 7. Server Management (MCSManager Gateway)

- **Instance control**: instance list and status, start / stop / restart / terminate; every operation first verifies the uuid / daemonId actually belongs to the configured ApiKey
- **Console**: real-time streaming + historical logs (tail-only by character count to avoid freezing the page on huge histories) + command dispatch
- **File management**: directory browsing, text editing (Monaco), rename, delete, create, archive/extract, **128 KiB chunked uploads** (large-file friendly), preview (including docx / Markdown / spreadsheets)
- **Backups**: stored in the instance's `/backups` directory; list / create (restricted filename pattern) / restore / delete / download
- **Configuration**: visual server.properties editing, scheduled task management, instance info
- The ApiKey is equivalent to full panel permissions — it **stays server-side only**, and the dashboard only reports "configured or not", never the plaintext

### 8. Website Content & Chat

| Endpoint | Description |
| -------- | ----------- |
| `/api/activities` | Server activities (type / date / content), managed from the dashboard |
| `/api/donors` | Donor list (avatar / name / intro / amount), managed from the dashboard |
| `/api/bans` | Ban list (player / ban time / unban time / reason), managed from the dashboard |
| `/api/updates` + `/api/update/[key]` | Update service: query latest version, type, forced-update flag, release date and changelog by key — **consumed by the mod / modpack update checker** |
| `/api/downloads` | Download projects (modpacks / mods: name / URL / version / description), managed from the dashboard |
| `/api/chat*` | Website chat: guests post behind Turnstile (nickname 2–16 chars, content 2–200 chars, 5 messages / minute, latest 500 retained); game players speak with account login (role badge + avatar); admins moderate / delete / clear; IP geolocation cached 7 days by hash |

### Server Status Worker

The website status page and this dashboard use the Cloudflare Worker at `https://status.mcyzw.top`:

- `GET /api/status`: current website, API, assets, mail service, EQAD-003 node, and Minecraft status;
- `GET /api/status/history?hours=72`: up to 72 hours of five-minute samples retained in the Worker's D1 database;
- the API server synchronizes every five minutes, while `GET /api/admin/status` also performs a catch-up sync into the local SQLite `status_history` table; the complete history can be cleared from Site Settings, and a clear-time watermark prevents older samples from being imported again;
- `YZWC_STATUS_WORKER_URL` overrides the Worker URL in a deployment environment (see `.env.example`).

### 9. Automated Deployment

- Publishing a GitHub Release triggers CI: `pnpm install --frozen-lockfile` → `pnpm build` → zip `.output` → `POST /api/deploy` (with `X-Deploy-Token`, compared via timingSafeEqual)
- The server applies **full security checks** to the deployment archive: path traversal, symlinks, duplicate paths, and CRC32 corruption are rejected; limits are 100 MiB compressed / 512 MiB extracted / 20,000 entries; verified archives are **atomically swapped into `.output`** (previous version kept for rollback), with a deploy lock preventing concurrency
- After deployment the process exits and is restarted by systemd / PM2 / Docker auto-restart; alternatively `YZWC_DEPLOY_RESTART_COMMAND` can be configured
- **Data is never touched**: `server/data/` (SQLite + uploads) is outside the swap scope

### 10. UI Experience

- **Material Web Components** (`@material/web`) + dark / light / system theme switching (with transition animations)
- **PWA**: manifest + icons + client registration, installable as a standalone app
- Page transitions, global toasts, unified confirmation dialogs, custom scrollbars
- **skinview3d** live 3D skin / cape preview (classic and slim models), **Monaco Editor** for code editing, mammoth / marked / xlsx file previews

---

## 🔐 Mod Integration: HMAC Signature Scheme

The YouzaiWorldCore mod (Minecraft server) must send signature headers when calling `/api/game/*`:

| Header | Requirement |
| ------ | ----------- |
| `x-yzwc-timestamp` | Unix seconds, at least 10 digits, clock skew ≤ 300 seconds |
| `x-yzwc-nonce` | 16–128 random characters, non-repeatable within 10 minutes (replay protection) |
| `x-yzwc-signature` | 64-character hex HMAC-SHA256 |

**Canonical string**: `{timestamp}.{nonce}.{METHOD}.{path}.{sha256(body)}` (path includes the query string; a GET body hashes the empty string). The key is the game API key configured on the dashboard's Site Settings page (32–512 characters); the `YZWC_GAME_API_KEY` environment variable is a legacy fallback. Request bodies are capped at 3 MiB.

---

## 🚀 Deployment

### Requirements

- Node.js **22+** (required by `node:sqlite`)
- pnpm 10+ (CI uses `pnpm/action-setup`)
- No external database / Redis needed: the SQLite file lives at `server/data/database.db`, with tables created and migrated automatically on first start

### Local Setup

```bash
pnpm install
pnpm build     # static verification
pnpm preview --port 3800   # preview the production build
```

> The dev server `pnpm dev` listens on `127.0.0.1:3800` by default (see `nuxt.config.ts`).

### Production Deployment

1. Prepare a process manager (systemd / PM2 / Docker); if the working directory is not the project root, set `YZWC_DATA_DIR` (or `YZWC_DEPLOY_ROOT`);
2. Configure the `DEPLOY_TOKEN` and `DEPLOY_URL` repository secrets;
3. Publish a GitHub Release — CI handles building, delivery, and restart verification automatically;
4. Visit the root path after first start to complete the OOBE setup.

### Environment Variables

Full annotated reference in [`.env.example`](./.env.example); key items:

| Variable | Purpose | Default |
| -------- | ------- | ------- |
| `YZWC_GAME_API_KEY` | Signing key for `/api/game/*` (prefer configuring in the dashboard) | none (game API returns 503) |
| `YZWC_DEPLOY_TOKEN` | CI deploy token, must match the Actions secret | none (deploy endpoint refuses) |
| `YZWC_DEPLOY_ROOT` / `YZWC_DEPLOY_RESTART_COMMAND` | Deploy root / restart command | process working directory / exit and let the process manager restart |
| `YZWC_INBOUND_MAIL_KEY` | Signing key for Email Worker delivery (independent from the game key) | none (inbound endpoint returns 503) |
| `YZWC_REPLY_TEMPLATE_PATH` | Reply template path for domain mail | `reply.html` in the working directory |
| `YZWC_MCSM_BASE_URL` / `YZWC_MCSM_API_KEY` | MCSManager panel URL and ApiKey | none (Server Manage page prompts for setup) |
| `NUXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` / `TURNSTILE_HOSTNAMES` | Dashboard login Turnstile | none |
| `TURNSTILE_CHAT_SITE_KEY` / `TURNSTILE_CHAT_SECRET` / `TURNSTILE_CHAT_HOSTNAMES` | Website chat Turnstile (falls back to the dashboard set) | none |
| `YZWC_IP_GEO_DISABLED` / `YZWC_MOJANG_DISABLED` | Disable IP geolocation / Mojang outbound calls | unset = enabled |
| `YZWC_ADMIN_USERNAME` / `YZWC_ADMIN_PASSWORD` / `YZWC_ADMIN_ENTRY` | Unattended OOBE initialization | none (page-guided) |
| `YZWC_GAME_SESSION_TTL_SECONDS` | Game session duration | 43200 (12 hours, 24-hour maximum) |
| `YZWC_STATUS_WORKER_URL` | Status Worker current/history endpoint | `https://status.mcyzw.top/api/status` |

> The production runtime does not read `.env` (development-only convenience); secret-type settings should be saved on the dashboard's Site Settings page (persisted to the database `settings` table, which takes priority over environment variables).

---

## 📁 Project Structure

```
YouzaiWorldApi/
├── nuxt.config.ts          # devServer 3800, nitro error handler, md-* custom elements, PWA meta
├── .github/workflows/release.yml   # Release → build → deliver to /api/deploy pipeline
├── app/                    # Admin dashboard frontend
│   ├── pages/              # 22 routes (dashboard / hidden login / account / 19 admin pages)
│   ├── components/         # OOBE, confirm dialogs, toasts, Monaco editor, skin preview, etc.
│   ├── composables/        # Session & permissions / hidden entry / theme / toast composables
│   └── middleware/auth.global.ts   # Client-side route guard
├── server/
│   ├── api/                # 174 endpoints: auth/ admin/ game/ inbound-mail deploy update/* public content
│   ├── middleware/         # Security headers, HMAC auth, entry guard, API page permissions
│   ├── plugins/            # Startup migration + audit log hook
│   ├── utils/              # db.ts (core) + MCSM / SMTP / mail / Mojang / deploy modules
│   └── data/               # Runtime data (gitignored): database.db, uploads/
├── shared/                 # Client/server shared: page permission model, API permission mapping, password policy, device detection
└── public/                 # Same-origin manifest, Service Worker and robots.txt
```

---

## 🤝 Related Projects

- **[YouzaiWorldCore](https://github.com/Youzai-World-Team/YouzaiWorldCore)** — the Youzai World core mod (Fabric, MC Java 26.2), the sole signed caller of `/api/game/*`
- **[YouzaiWorldWebNew](https://mcyzw.top)** — the official website, consuming this service's public content endpoints and chat

---

## 📄 License

This project is licensed under [Apache-2.0](./LICENSE).
