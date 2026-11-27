# api.secrets

> Your world. Your people. Your space.

pnpm TypeScript monorepo for **Secrets**:

| Path | What |
| --- | --- |
| `apps/api` | Fastify backend — auth, profiles, realtime messaging (WebSockets), Docks, attachments. Serves the web build in production. |
| `apps/web` | React + Vite client — three-panel desktop, bottom-nav mobile, violet-on-black design system. |
| `packages/shared` | Shared types: message envelope, REST routes, WS frames, AI and voice contracts. |

Related repos: [docs.secrets](https://github.com/titan717/docs.secrets) · [ai.secrets](https://github.com/titan717/ai.secrets) · [voice.secretsapi](https://github.com/titan717/voice.secretsapi)

## Run locally

```bash
corepack enable
pnpm install
pnpm dev        # api on :8080, web on :5173
```

No database needed for a first run: without `DATABASE_URL` the API uses embedded Postgres (PGlite) in `./data`. Without `REDIS_URL` WebSocket fan-out is in-process.

## Deploy (one click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/titan717/api.secrets)
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https://github.com/titan717/api.secrets)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/titan717/api.secrets&env=VITE_API_URL,VITE_AI_URL,VITE_VOICE_URL)

- **Render** (`render.yaml`): API + web on one service, with Postgres and Redis.
- **Railway** (`railway.json` + `Dockerfile`): API + web in one container. Add a Postgres plugin and set `DATABASE_URL` (optional).
- **Vercel** (`vercel.json`): web client only (Vercel cannot host the WebSocket server). Set `VITE_API_URL` to your Render/Railway API URL.

See `.env.example` for all variables.
