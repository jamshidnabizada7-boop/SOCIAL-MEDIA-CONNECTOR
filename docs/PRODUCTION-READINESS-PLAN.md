# Aria Hub — Production Readiness Plan

Written 2026-10-24 from a full source review. Every item marked ✅verified was confirmed by reading the code.

## Where things stand today

| Check | Result |
|---|---|
| `npm run typecheck` (all 6 backend workspaces) | ✅ 0 errors |
| `npm test` | ✅ 80 tests pass (api 30, worker 21, providers-core 19, media-core 10). `@aria/db` has no tests (now `--passWithNoTests`). |
| `npm run build:web` | ✅ builds |
| Backend ESLint (new) | ❌ 23 errors, all unused imports (quick cleanup) |
| Version control | Git initialized 2026-10-24, no commits yet |

**Verdict:** the code compiles and the happy-path tests pass. It is **not safe for public use yet**:
- One customer can read or edit another customer's posts.
- The publishing engine can double-post.
- YouTube, Pinterest, Instagram, Threads and TikTok publishing don't actually work end to end.

Phases 1–2 are hard launch blockers. Phase 5 depends on platform approvals that take weeks, so **start Phase 5 paperwork today, in parallel**.

---

## Phase 0 — Hygiene (½ day)
- [x] `git init`; `.gitignore` now covers nested `node_modules/`, `dist/`, `**/tmp/`, `apps/api/.test-data/`
- [x] Backend ESLint config, plus `npm run lint` and `npm run typecheck` scripts
- [ ] Fix the 23 unused-import lint errors, then make the first commit
- [ ] Delete files holding secrets or debug output:
  - `apps/api/tmp/checkcred.mts` (prints token prefixes)
  - `packages/db/tmp/*`
  - `.local/smoke3/c.txt` and `.local/smoke4/` cookie jars
  - `apps/api/.test-data/` (199 MB)
  - empty root `src/`
- [ ] `.dockerignore`: change `dist`/`node_modules` to `**/dist`, `**/node_modules`, and add `**/.test-data`, `**/tmp`
- [ ] Declare the missing deps: `@aria/providers-core` in api and worker, `zod` in worker
- [ ] Remove the duplicate `sessionHook` registration (`apps/api/src/server.ts:91` vs `modules/auth/routes.ts:24`)

## Phase 1 — Security blockers (2–3 days)
1. **Cross-tenant IDOR** ✅verified. Every handler loads rows by id without `workspaceId`.
   - Scope every query by `req.member.workspaceId` in:
     - `apps/api/src/modules/posts/routes.ts`: get, patch, publish, schedule, cancel, retry, delete
     - `queue/routes.ts:135`
     - `accounts/routes.ts:63`
   - Add a test per route: a user in workspace A requests a resource in workspace B and must get 404.
2. **Invited members get full access** ✅verified (`plugins/auth.ts:125-140` never checks `status`).
   - Require `status = 'active'`.
   - Add an invite-accept endpoint with a token.
3. **Webhooks**
   - Register a raw-body content-type parser and verify the HMAC on the exact bytes (`webhooks/routes.ts:121`).
   - Reject unverified payloads; don't store them.
   - Add Meta's `GET hub.challenge` verification.
4. **SSRF:** for Mastodon/Bluesky instance URLs (`providers-core/src/oauth.ts:250`):
   - Require `https`.
   - Resolve DNS and block private, loopback and link-local ranges.
   - Set a timeout.
5. **Encryption key**
   - Make `ARIA_ENCRYPTION_KEY` required in production config.
   - Reject anything that isn't 64-hex or base64-32. Don't SHA-hash weak strings (`packages/db/src/crypto.ts:52`).
6. **Headers and proxy**
   - Add `@fastify/helmet`.
   - Set `trustProxy` to the Caddy/Cloudflare hop only, not `true`.
   - Move rate limiting to Postgres or Redis so it survives restarts and multiple instances.
   - Add login lockout.
7. **Cookies and CSRF:** serve web and API from one site (see Phase 4) so `SameSite=Lax` works, or add a CSRF token if they stay split.
8. **Logging:** stop logging provider error bodies in the OAuth callback (`oauth/routes.ts:261`), and audit the admin circuit reset.

## Phase 2 — Publishing engine correctness (4–6 days)
1. **Atomic job claim.** Replace the unconditional `active` update (`pipeline/publish.ts:128`) with `UPDATE … WHERE id=$1 AND state IN ('pending','delayed') RETURNING`. A run that doesn't win the claim exits.
2. **No double posts** ✅verified.
   - When a job moves to `delayed`, set `runAt` to the real next time.
   - When `createPost` returns async, insert `remote_posts` with the provider's id immediately, so idempotency holds.
3. **Reconcile** ✅verified (`publish.ts:410-445`):
   - Pass the decrypted credential to `getPostStatus`.
   - Use the stored provider id, not `pending_<id>`.
   - Handle `failed`.
   - Use backoff (30 s, 1 m, 5 m…) with a max age, then fail with a message.
   - Store the real permalink instead of `example.invalid`.
4. **Stale jobs:** add a lease (`lockedUntil`). The sweep re-claims `active` jobs whose lease expired.
5. **BullMQ:** the driver is a no-op ✅verified (`queue/bullmq.ts:48`). Decision: **delete it** and rely on the Postgres queue plus sweep, which is enough at this scale. Implement it properly only if you outgrow that.
6. **TikTok:**
   - Remove it from the OAuth provider list until a real adapter exists.
   - Make `getAdapter` **throw** in production instead of falling back to the mock (`adapters/registry.ts:42`).
7. **Per-network variants** ✅verified (nothing inserts `postVariants`):
   - The API accepts and stores variants on create and patch.
   - The web app sends YouTube title and Pinterest board.
8. **Web composer** ✅verified (`apps/web/src/lib/services/backend.ts:209`): send `mediaIds`, `variants`, `scheduledAt` and `aiDisclosed`.
9. **Media storage** ✅verified:
   - Set `ARIA_STORAGE_DIR=/data/storage` in both api and worker (`deploy/docker-compose.prod.yml`) so they share the volume.
   - Add a signed, expiring public media URL (`/v1/media/:id/public?sig=…`) and set `APP_PUBLIC_MEDIA_BASE_URL`. Instagram and Threads need this.
10. **Transactions:** wrap post create (plus media ownership check), publish, schedule and cancel in `db.transaction` ✅verified (0 exist).
11. **Token refresh**
    - Use the existing advisory-lock helper (`apps/worker/src/tokens/refresh-lock.ts`) inside `withRefreshLock` (`providers-core/src/credentials.ts:28`).
    - Have the connection monitor refresh proactively.
    - Fix Threads refresh to call the Threads endpoint.
    - Use per-provider client auth: Basic auth for Pinterest and X, `client_key` for TikTok.
12. **Tests:** run the real-adapter path against recorded HTTP fixtures (nock/msw), and test reconcile, the claim race and stale-lease recovery.

## Phase 3 — Product completeness (4–7 days)
- **Email (SMTP or Resend):** password reset, email verification and email invites. Wire up the web `forgot-password` and `onboarding` pages.
- **Seed `plans` in a migration** so production has them (`workspaces.plan_id` references `plans`).
- **Platform admin bootstrap:** a CLI command instead of hand-written SQL.
- **Billing:** either integrate Stripe (checkout, webhook, portal) **or** hide billing and launch free. Enforce `maxChannels`, `maxScheduledPosts`, seats and storage on the server either way.
- **Analytics:** add scheduled pull jobs per provider, **or** hide the analytics pages for v1.
- **Web:** remove the remaining mock-only paths in API mode (e.g. billing, `backend.ts:634`), and add error and empty states.
- **Docs:** update the README and ARCHITECTURE (32 tables; web is no longer mock-backed; 9 adapters, not 10), and add the missing env vars to `.env.example`.

## Phase 4 — Infrastructure and operations (3–4 days)
1. **Stable domain.** The quick tunnel URL changes on every restart, which breaks OAuth. Use a real domain with a **named Cloudflare Tunnel** (free), e.g. `app.<domain>` for web and `app.<domain>/v1` for the API through Caddy. One site fixes the cookie and CORS problems, so you can drop the separate Vercel copy.
2. **Docker**
   - Multi-stage build, non-root user, production dependencies only.
   - Commit a lockfile that includes the linux-arm64 optional binaries (`npm install --os=linux --cpu=arm64`, or generate it in a Linux container) so `npm ci` works. Then remove `--legacy-peer-deps` and the lockfile deletion.
   - Add a worker healthcheck.
3. **Migrations run automatically** on deploy (a one-shot `migrate` service before api and worker).
4. **Backups**
   - Nightly `pg_dump` plus the media volume, copied off-box (Oracle Object Storage or R2), with 14-day retention.
   - **Do one test restore.**
5. **Observability**
   - pino structured logs in the worker.
   - Sentry (free tier) for api, worker and web.
   - Uptime check on `/health`.
   - Alert on failed-publish rate and on open circuit breakers.
6. **CI (GitHub Actions):** lint, typecheck, test and build on every push. Deploy from CI, or replace the tar-over-ssh step with a script.
7. **Runbook** in `deploy/DEPLOY.md`: deploy, rollback, restore, key rotation, tunnel restart.

## Phase 5 — Platform approvals (external, 2–8 weeks; start now)
Without these, real users other than you can't connect accounts:

| Platform | What's needed |
|---|---|
| Meta (Facebook, Instagram, Threads) | App Review for `pages_manage_posts`, `instagram_content_publish` and the `threads_*` scopes. Business verification, privacy policy URL, data-deletion callback, screencast. Also update Graph API v23 to the current version (`providers-core/src/config.ts:29`). |
| Google (YouTube) | OAuth consent verification for `youtube.upload` (sensitive scope). A YouTube API audit if you need more than the default quota. |
| LinkedIn | Community Management API access for organization posting. |
| TikTok | Content Posting API audit; unaudited apps can only post privately. |
| X | Paid API tier; set `X_POSTING_ENABLED=true` only after budgeting. |
| Pinterest | Standard access (trial access is sandbox only). |
| Legal | Privacy policy, terms of service and a data-deletion page on the public domain. All of the above require them. |

## Phase 6 — Verification and launch (2–3 days)
- E2E (Playwright): sign up, connect a Bluesky or Mastodon account, compose with media, schedule, confirm it published.
- A manual live test per approved platform with a real test account.
- Load test: 1,000 scheduled posts due at the same minute, checking for no duplicates and the drain time.
- Security pass: rerun the Phase 1 cross-tenant tests, `npm audit`, and confirm no secrets in the repo.
- Soft launch to a few users for 1–2 weeks, with error dashboards watched daily, before an open launch.

---

**Estimated engineering time:** about 3–4 weeks (Phases 0–4 and 6). Platform approvals (Phase 5) run in parallel and decide which networks are live on launch day. Launch with the networks that are approved (Bluesky and Mastodon need no approval) and turn on the others as they clear.
