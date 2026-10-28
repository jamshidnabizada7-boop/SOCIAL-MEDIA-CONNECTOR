# Universal Feed production-readiness audit — 29 October 2026

This report covers the supported Feed release candidate in PR #2. It does not
certify unrestricted access to every social network or claim deployment on Oracle.
Production remained on `df68e34577878b09df0f313562fff5c630054826` during these checks.

## Real end-to-end behavior

- An isolated API/database/worker run retrieved 30 genuinely mixed Bluesky and
  YouTube items, with unique native IDs and a persisted bookmark round trip.
  Public provider requests used real endpoints, without account tokens or paid APIs.
- In the production Next.js build, the real YouTube player progressed beyond
  85 seconds. Native play, pause and mute were observed. This used the official
  privacy-enhanced iframe and the public Google for Developers example video.
- A real public Bluesky clip played through its official full-post embed to its
  9.728-second duration. Closing the player left zero iframes. Long post captions
  can require scrolling inside Bluesky's embed; the interface now explains this.
- These browser checks used an isolated local workspace. No production records,
  OAuth settings, native social posts, public comments or email messages changed.

Native-player screenshots are retained privately under `.local/feed-evidence/`.
Automated browser tests continue to use fixtures so CI cannot publish real posts,
spend provider quota or depend on third-party playback availability.

## Readiness fixes

1. Removing a muted/reduced source left stale preference IDs, which blocked later
   preference saves. A regression reproduced the failure; source removal now
   prunes its personal preference references in the same database transaction.
2. Concurrent additions could race the 30-source cap. Subscription creation now
   serializes per user, and a concurrent test confirms one addition succeeds while
   the other receives the source-limit response. Enabling default subscriptions
   for an already-full profile no longer prevents reading/managing the feed.
3. A generic sensitive-content toggle could expose Bluesky's non-overridable
   restrictions. Public display now drops `!hide`, `!warn`, `!no-unauthenticated`
   and age-restricted labels from posts, authors and self-labels. Negated labels
   are respected; an invalid expiry cannot neutralize a restriction. Nudity remains
   behind the explicit sensitive preference. These paths do not implement a native
   authentication/age gate and therefore omit restricted content conservatively.
4. Link-only references had no verified creator but could still create a local
   follow. The UI now omits that control and the API rejects such follows. Existing
   local follows can still be removed.

The moderation behavior follows [Bluesky's official moderation documentation](https://github.com/bluesky-social/bsky-docs/blob/main/docs/advanced-guides/moderation.md).

## Bounded feed load check

`npm run test:feed-load` creates a fresh isolated database, blocks outbound fetches,
and browses eight user profiles concurrently in one workspace. Each profile has
240 posts from two providers. All 160 page requests succeeded and all 1,920 cached
items remained reachable, with no duplicate native IDs or personal-source leaks.

The latest local run measured p95 **312 ms**, maximum **332 ms**, with zero external
provider calls. The test gates this workload at p95 below two seconds and runs in
CI. An earlier run under parallel verification load measured p95 1,285 ms. These
are local PGlite results, not an Oracle capacity/SLA claim or a large-scale forecast.

## Automated release gates

The initial candidate passed 232 application tests, seven API browser cases, two
demo cases, 25 operations tests, four monitor tests, the 1,000-post publishing load
test and Linux container/migration/database-media backup/restore CI. The hardening
adds eight application regression cases, bringing the application suite to 240.

The updated candidate must pass the complete GitHub application and container
jobs, including the new feed load check, before promotion. Exact revision/status
is recorded in [PR #2](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/pull/2).
Lint retains 48 pre-existing warnings and no errors. Native playback evidence
does not establish another provider's approval or guarantee third-party uptime.

## Production configuration and release scope

**Deployment blocker:** the root filesystem had 2,245,591,040 bytes free (about
2.09 GiB, under five percent). Restore adequate headroom before building/deploying
another release or accepting sustained media uploads. Existing backups, rollback
images, volumes and the independent older installation were preserved during
this read-only audit; reclaimable space is not assumed safe to delete.

Read-only Oracle checks confirmed public health/sign-in HTTP 200, security headers,
an active tunnel, an active/enabled backup timer and a completed backup about five
hours old. The encryption key and SMTP configuration are present. Compose injects
the database URL into service containers; it need not exist in the root env file.
The external production monitor's actual scheduled run at 19:08 UTC on 28 October
completed successfully (run `40751648988`), confirming scheduler execution rather
than merely the presence of a schedule definition.

No YouTube Data API key is configured on Oracle. Public YouTube URL metadata and
playback work without it; server-side discovery/search needs that key or approved
account authorization. Mastodon instance authentication, TikTok Display approval
and `video.list`, legitimate Meta/Threads connections, and other provider approvals
remain the explicit capability gates documented in [Universal Feed](UNIVERSAL-FEED.md).
X/LinkedIn/Pinterest are link references, not unrestricted discovery integrations.

This is a candidate for a controlled release of the supported capabilities after
green CI, adequate disk headroom and an authorized migration/deployment. It is not an all-provider public
launch certificate. No deployment or live database migration was part of this audit.
