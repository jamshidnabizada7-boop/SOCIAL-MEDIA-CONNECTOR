# Oracle Feed and Stitch deployment — 29 October 2026

Application revision: `1d017e373c143256f728d82ea07f61ba6f9857fc`.
Previous revision: `df68e34577878b09df0f313562fff5c630054826`.
Public application: https://app.myariahub.com.

## Space and isolation

The user authorized deploying this release and freeing SehatAI space while
preserving the independent older Aria Hub installation. Only `node_modules`
folders in five inactive releases under `/opt/sehatai/releases` were removed.
All five resolved paths were checked against that root, the current symlink and
running processes before removal. This reclaimed 1,309,446,144 bytes. SehatAI's
current release, source, shared storage and logs were retained.

No files, runtime services or databases in the independent older Aria Hub
installation were modified. Its web, candidate, import, social and translation
services, tunnel and host Caddy retained identical PIDs and start times. Both
older PostgreSQL containers retained their IDs and start times. The running
SehatAI service also retained its PID and start time.

## Release and recovery

Production ARM64 runtime images were built on a native GitHub runner rather than
compiling on the nearly full VPS. The [image packaging run](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/actions/runs/40858709151)
passed. GitHub's artifact digest, every manifest checksum, the source archive
against the local committed checkout, both revision labels and both image
architectures were verified before applying the release.

A quiesced pre-upgrade backup `backup-20261029T103520Z` was taken and exported into
an authenticated encrypted local recovery bundle. Existing backups and images
were retained. The previous app and web images have `pre-stitch-df68e3457787`
rollback tags. The running API source tree was checked against its rollback
image because Docker's older container image ID could not be resolved directly.

After upgrading and renewing the Facebook grant, a second quiesced snapshot
`backup-20261029T110414Z` was encrypted/authenticated locally and uploaded only
as `.ariabak` to the existing private Drive backup folder. Metadata confirmed
its private parent; downloading it through the connector reproduced SHA-256
`2fef89adc25794ebb23253b16dff59f4e01dc5592cc49b7d605d0d0cef4239df`
at 276,516 bytes. The recovery ledger retained all five verified cloud snapshots
and their history. Recovery keys remain local and were never uploaded.

The operations lock covered image selection, source extraction, migrations and
health checks. Migration 0009 added eight Feed tables; production increased from
41 to 49 public tables. The migration exited successfully. API, worker, web,
PostgreSQL and the gateway became healthy before `REVISION` advanced. Available
disk space immediately after deployment was 2,649,329,664 bytes (about 2.47 GiB).
The nightly backup timer remains enabled and active, the named tunnel is active,
and the five-minute component monitor reports success.

## Verification

The exact deployed revision passed [application and container CI](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/actions/runs/40858716248):
240 application tests, nine API browser cases, five demo browser cases, 29
operations cases, four monitor cases, type checks, builds, dependency audit,
publishing/feed load checks and Linux database/media backup/restore checks.
Lint has zero errors and 46 existing warnings.

After deployment, the sign-in page and all seven application routes returned
HTTP 200. Production JavaScript/CSS assets returned 200, security headers were
present, both public health hostnames reported native PostgreSQL healthy, and
unauthenticated `/v1/auth/me` correctly returned 401.

The user signed into the live application in Edge. Creator Studio, Inbox and
Profile/Channels loaded real workspace data. The older Facebook token in this
workspace was rejected; normal Facebook reauthorization renewed the existing
grant. Its three authorized Pages then passed the application's credential
checks. A real Inbox synchronization imported provider interactions, and a
conversation opened with healthy sync and an available reply capability. No
social post or reply was sent during this release verification.

The production Home Feed loaded real Facebook and public Bluesky posts; Explore
rendered 12 collected posts, and the video screen listed nine real Bluesky
videos. Composer displayed the three authorized Page targets and kept publishing
disabled for an empty post. These checks used the user's normal signed-in
production session, with no demo banner or fixture substitution.

The desktop Inbox used the production Inter and Plus Jakarta Sans fonts without
a demo banner. At 390px, the conversation details panel fit the screen, trapped
focus, closed with Escape and restored scrolling/focus. The full mobile drawer
also closed with Escape and restored its trigger. No horizontal overflow was
observed in these live checks. Screenshots are private ignored artifacts under
`.local/stitch-live-evidence`.

The most recent completed scheduled public GitHub health run was still
08:51 UTC when checked after deployment, beyond the 60-minute freshness limit.
This previously reported scheduler delay remains unresolved. Fresh direct
public probes passed; they do not establish that an unattended scheduled run
executed. The separate Oracle component monitor reports success.

Immediately after migration, original user/workspace/account/media/post counts
were preserved and the aggregate stored-media SHA-256 was unchanged. Subsequent
Facebook reconnection and Inbox synchronization legitimately added channel and
interaction records. This does not certify unrestricted provider approval;
capability and account-specific limits in `UNIVERSAL-FEED.md` still apply.
