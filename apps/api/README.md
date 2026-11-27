# @secrets/api

Fastify 5 REST + WebSocket backend for **Secrets** — "Your world. Your people. Your space."
Implements the contract in [`packages/shared/src`](../../packages/shared/src) (`api.ts`, `ws.ts`, `envelope.ts`, `types.ts`).

## Run

```bash
pnpm install
pnpm --filter @secrets/api dev        # tsx watch, http://localhost:8080
pnpm --filter @secrets/api build      # tsup -> apps/api/dist/index.js (bundles @secrets/shared)
node apps/api/dist/index.js           # production start (what render.yaml / Dockerfile run)
```

Zero-config: with no env vars it boots on embedded Postgres (PGlite) persisted to `./data/pglite`,
an in-process event bus, and a dev JWT secret (logged as a warning).
If `apps/web/dist` exists it is served on the same origin with SPA fallback (non-`/v1` paths).

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `8080` | Binds `0.0.0.0` (`HOST` to override) |
| `DATABASE_URL` | – | Postgres via `pg`. SSL (`rejectUnauthorized: false`) unless localhost / `sslmode=disable`. Unset → PGlite |
| `PGLITE_DIR` | `./data/pglite` | PGlite data dir |
| `REDIS_URL` | – | ioredis pub/sub fan-out + presence across instances. Unset → in-process |
| `JWT_SECRET` | dev secret | HS256. Payload `{ sub: userId, username, did: deviceId }` (shared with voice service) |
| `JWT_TTL` | `7776000` | Session lifetime (s), 90 days |
| `CORS_ORIGIN` | `*` | Comma-separated origins |
| `WEB_DIST` | auto | Override path to the web build |
| `PG_POOL_MAX` | `10` | |

Migrations (`src/db/migrations.ts`) are plain SQL, applied once each at boot inside a transaction
(advisory-locked on Postgres). First boot seeds the bot user `@secrets` and the public dock
**Secrets HQ** (`secrets-hq`) with `#general` and `#announcements`; every signup auto-joins it.

## Layout

```
src/
  index.ts           boot: db → migrate → seed → redis → listen
  app.ts             fastify setup, error handler, static web, route registration
  config.ts
  db/                adapter (pg | pglite), migrations, seed
  lib/               errors/validation helpers, row → view mappers
  modules/
    auth/            signup/login/logout, JWT + revocable device sessions
    users/           me, profile, search, presence snapshot
    conversations/   dm/group CRUD, members, read receipts, access checks
    messages/        the single send pipeline (REST + WS), list, edit, delete, reactions, pins, sync
    docks/           docks, roles, invites, channels
    attachments/     image upload (bytea in DB), public GET
    realtime/        /v1/ws, event bus (local or Redis), presence
```

## REST endpoints

Auth: `Authorization: Bearer <token>` (also accepted: `x-secrets-token` header). Errors are `{ error, message }`.

**Auth** — `POST /v1/auth/signup` `{username,password,display_name?}` → `Session` (201) ·
`POST /v1/auth/login` → `Session` · `POST /v1/auth/logout` (revokes this device; closes its sockets) ·
`GET /v1/auth/username-available?username=` · extra: `GET /v1/auth/sessions`, `DELETE /v1/auth/sessions/:deviceId`.
Usernames: 3–24 chars `[a-z0-9_.]`, case-insensitive (stored lowercase). Passwords ≥ 8 chars.

**Users** — `GET /v1/me` · `PATCH /v1/me` `{display_name≤48, about≤160, avatar_url, accent}` ·
`GET /v1/users/search?q=` · `GET /v1/users/:username` · extra: `GET /v1/presence?ids=a,b`.

**Conversations** — `GET /v1/conversations` (dm + group, newest activity first; extra `?include_channels=1`) ·
`POST /v1/conversations/dm {user_id}` (unique per pair; 201 when new) · `POST /v1/conversations/group {title, member_ids}` ·
`GET|PATCH /v1/conversations/:id` · `POST /v1/conversations/:id/members {user_ids}` ·
`DELETE /v1/conversations/:id/members/:userId` (self = leave; owner/admin to remove others) ·
`POST /v1/conversations/:id/read {message_id}`.
`GET /v1/conversations/:id` also works for channel conversations.

**Messages** — `GET /v1/conversations/:id/messages?before=<messageId>&limit=≤100` (newest first) ·
`POST /v1/conversations/:id/messages {ciphertext, nonce, client_msg_id}` (idempotent on sender+client_msg_id; 201 new / 200 duplicate) ·
`POST /v1/messages/:id/reactions {emoji}` · `DELETE /v1/messages/:id/reactions/:emoji` ·
extras: `GET /v1/messages/:id`, `PATCH /v1/messages/:id {ciphertext, nonce}` (sender only; sets `edited_at`),
`DELETE /v1/messages/:id` (soft delete → `deleted: true`, ciphertext `{}`; sender, group owner or dock admin),
`POST|DELETE /v1/messages/:id/pin`, `GET /v1/conversations/:id/pins`. `MessageView` carries an extra `pinned` boolean.
`reply_to` and `attachments` live inside the body (`sealBody`/`openBody`); the server validates `reply_to` is in the same conversation.
`#announcements` channels are admin-only for posting. Clients can't send `kind: "system"`.

**Attachments** — `POST /v1/attachments` multipart field `file` (PNG/JPEG/GIF/WebP/AVIF ≤ 8 MB; sniffed by magic bytes; width/height detected) → `Attachment` ·
`GET /v1/attachments/:id` (public by unguessable id so `<img src>` works; immutable cache headers + ETag). Use the URL for avatars too.

**Docks** — `GET /v1/docks` (`?mine=1` for joined only) · `GET /v1/docks/discover?q=` · `POST /v1/docks {name, handle, description?, visibility}` (creates `#general`) ·
`GET|PATCH|DELETE /v1/docks/:id` · `POST /v1/docks/:id/join {invite_code?}` · `POST /v1/docks/:id/leave` ·
`POST /v1/docks/:id/invite {rotate?}` → `{invite_code}` · `GET /v1/docks/:id/members` ·
`PATCH /v1/docks/:id/members/:userId {role}` (setting `owner` transfers ownership) · `DELETE /v1/docks/:id/members/:userId` ·
`POST /v1/docks/:id/channels {name, topic?}` · `PATCH|DELETE /v1/docks/:id/channels/:channelId` ·
extras: `GET /v1/docks/by-handle/:handle`, `POST /v1/docks/join-by-code {invite_code}`.
Roles: owner/admin manage channels, members and invites; only owner deletes, changes visibility, transfers ownership.
Private docks are invisible (404) to non-members. Public dock channels are readable by non-members; posting requires joining.

**Health** — `GET /health` → `{ ok: true, db: "postgres"|"pglite", redis: "on"|"off" }`.

## WebSocket — `/v1/ws?token=<session token>`

Implements `ws.ts`. On connect: `ready`, then `presence` frames for online contacts. Server sends `ping` every 25 s;
reply `{t:"pong"}` or the socket is dropped after a missed ping.

Client → server: `sync {since}` → `sync.batch` (messages created/edited after `since` across all your conversations
incl. channels, ascending, max 1000; `since: null` → empty batch — load history via REST) · `msg.send` → `msg.ack`
(also for duplicates) or `error {client_msg_id}` · `typing` (throttled 1/2 s) · `read` · `react {on}`.

Server → client: `msg.new` (to all audience members and the sender's other devices), `msg.update` (edit/delete/reaction/pin),
`typing`, `read` (dm/group members; channels only your own devices), `conversation.upsert` (new dm/group, membership or title changes),
`conversation.remove` (removed from group, channel/dock deleted), `dock.upsert` (dock/channel/member changes, sent to members),
`presence` (to users who share a dm/group).
