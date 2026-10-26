# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Layout & running
- npm workspaces: `apps/{web,api,worker}`, `packages/{db,shared-types,providers-core,media-core}`. Root `src/` is an empty leftover, so don't put code there.
- `@aria/db` and `@aria/shared-types` resolve to `dist/`: run `npm run build -w @aria/db -w @aria/shared-types` after changing them. `providers-core` and `media-core` export raw `.ts`.
- API and worker run via `tsx` (dev and prod). `node dist/...` doesn't work because of the raw-TS packages.
- Local DB: run `npm run dev:db` (PGlite over the Postgres wire protocol on 127.0.0.1:5438) and set `DATABASE_URL=postgres://aria:aria@127.0.0.1:5438/ariahub` for both api and worker. Without it, each process opens the PGlite directory on its own.
- Schema changes: edit `packages/db/src/schema`, then `npm run db:generate`, then `npm run db:migrate`.
- Web uses mock services unless `NEXT_PUBLIC_DATA_MODE=api`. Mock state lives in localStorage (`aria-mock:*`).
- `npm run lint` (root ESLint for api/worker/packages, then web's Next config) and `npm run typecheck` (tsc --noEmit per backend workspace). Run both before calling work done.

## Tests
- vitest per workspace: `npm test -w @aria/api`, or a single test with `npx vitest run test/posts-flow.test.ts` from `apps/api`.
- Worker unit tests force `ARIA_ADAPTER_MODE=mock`. `npm run test:e2e` exercises the real Bluesky HTTP adapter against a local fixture, not a live account.
- `npm run test:ops` checks backup/restore/deployment failures. On Debian/Ubuntu, `pg_virtualenv -t sh scripts/postgres-backup-test.sh` validates real PostgreSQL schema/data/media recovery in a throwaway cluster.

## API conventions
- Errors: `{ error: { code, message } }` with a user-facing message. Non-members get 404 (no existence leak); insufficient roles get 403.
- `requireWorkspacePermission` only checks membership of `:workspaceId`. Every handler must also scope its queries by `workspaceId` (post, target, account and queue ids are not tenant-checked otherwise).
- `:workspaceId` may be the literal `current` (resolved in `plugins/auth.ts`).
- Provider credentials in the DB (Admin → Provider credentials) override env vars. OAuth tokens are AES-256-GCM-encrypted with `ARIA_ENCRYPTION_KEY` (dev key: `.local/encryption.key`). Never log tokens.
- See `.env.example` for optional provider, storage, public-media and webhook environment variables. Do not put real credentials in tracked templates.

## Deploy
- See `deploy/DEPLOY.md`: the prepared stack uses `deploy/docker-compose.prod.yml` behind a named Cloudflare tunnel and one permanent origin. The older Oracle/Vercel installations are separate and unchanged.
- Host deployment/backup/restore commands share `.aria-operations.lock`. Restore leaves publishing paused until deliveries after the snapshot have been reconciled.
- Don't touch the deployed server, Vercel or provider apps without being asked explicitly.

## Production readiness
- Work toward launch follows `docs/PRODUCTION-READINESS-PLAN.md`. Do phases in order, and tick items off there when done.
