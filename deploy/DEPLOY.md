# Aria Hub v2 — Production Deployment (Oracle VPS + Vercel + Cloudflare)

This is the **v2 stack** (this repository). It runs alongside the older
`/opt/aria-hub` install on the same server without touching it.

## Topology

| Piece | Where | How it's exposed |
|---|---|---|
| Postgres 16 (new, dedicated) | VPS, Docker volume `pgdata` | Internal only |
| API (Fastify) | VPS, container on 127.0.0.1:14100 | Cloudflare quick tunnel (HTTPS) |
| Publishing worker | VPS, container | Internal (shares `media` volume with API) |
| Web (Next.js) | Vercel project `ariahub-app-v2` | Vercel CDN + second copy on 127.0.0.1:13000 |
| Older v1 install | VPS `/opt/aria-hub` (systemd + cloudflared) | Untouched |

Inbound ports 80/443 are blocked by the Oracle cloud security list, so public
HTTPS goes out through Cloudflare tunnels (outbound-only connections).

## Files

- `deploy/api.Dockerfile` — API + worker image (tsx runs TS from source because
  workspace packages resolve to `src/`).
- `deploy/web.Dockerfile` — Next.js image; `NEXT_PUBLIC_*` baked via build args.
- `deploy/docker-compose.prod.yml` — postgres + api + worker + web.
- `deploy/env.production.example` — template for `/opt/ariahub-v2/.env`.

## Daily operations (on the VPS)

```bash
cd /opt/ariahub-v2
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env ps      # status
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env logs -f api   # logs
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env restart api
sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env exec api npx tsx packages/db/src/migrate.ts   # migrations
```

## Deploying a new version

From the repo (Windows):

```bash
tar czf - --exclude=node_modules --exclude=.next --exclude=.local --exclude=.git \
  --exclude='*.log' --exclude='apps/web/.env.local' --exclude='.vercel' . \
  | ssh ariahub-oracle "tar xzf - -C /opt/ariahub-v2"
ssh ariahub-oracle "cd /opt/ariahub-v2 && sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env up -d --build"
ssh ariahub-oracle "cd /opt/ariahub-v2 && sudo docker compose -f deploy/docker-compose.prod.yml --env-file .env exec api npx tsx packages/db/src/migrate.ts"
```

Vercel web: `cd apps/web && vercel deploy --prod`.

## Known limitation: quick-tunnel URL

The API's public URL is a free Cloudflare *quick tunnel*
(`https://<random>.trycloudflare.com`). It changes when the tunnel process
restarts, and then two things must be updated together:

1. `APP_BASE_URL` + `WEB_ORIGIN` in `/opt/ariahub-v2/.env` → `sudo docker compose ... up -d --force-recreate api worker`
2. Vercel env `NEXT_PUBLIC_API_URL` (project `ariahub-app-v2`) → redeploy web

**To make the URL permanent (recommended next step):** create a real Cloudflare
named tunnel (`cloudflared tunnel login` needs one browser sign-in) routed to
`api.myariahub.com`, or open ports 80/443 in the Oracle Cloud security list and
put Caddy in front. Both are 15-minute jobs once the user has console access.

## First customer of record

OAuth credential setup: Admin → Provider credentials (needs a platform admin —
flip `users.is_platform_admin = true` in the v2 Postgres for your account).
Bluesky/Mastodon need no registration and work immediately.
