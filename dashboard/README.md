# Liquidation Shield — Dashboard

Next.js 14 App Router control center for the Liquidation Shield keeper: a live health-factor gauge, the ranked intervention plan, and the full assess → plan → execute/refuse audit trail.

## Stack

Next.js 14 · Tailwind CSS · Geist Sans/Mono · Phosphor Icons · Motion

## Local development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). By default it looks for a local decision log at `../decision-real.log.json` (written by `pnpm demo:real` / `demo:save` / `demo:refuse` from the repo root) and falls back to a scripted demo scenario if none exists.

## Connecting a deployed backend

Set `BACKEND_URL` to a running instance of `pnpm server` (see `agent/src/keeper-backend/src/server.ts`, deployable to Render/Railway/etc. — see the repo root README):

```bash
BACKEND_URL=https://your-backend.onrender.com pnpm dev
```

The `/api/decisions` route proxies to `${BACKEND_URL}/api/decisions` server-side, so the browser never talks to the backend directly and no CORS configuration is required on either side.

## Deploying

Import this repo on Vercel with **Root Directory set to `dashboard`**, and set `BACKEND_URL` as an environment variable on the Vercel project once the backend is deployed.
