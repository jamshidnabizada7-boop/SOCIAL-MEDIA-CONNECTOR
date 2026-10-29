# Universal search and feed media — production verification

The newer [profile-picture patch](ORACLE-PROFILE-PHOTOS-2026-10-29.md) is now deployed.
The verification below records its preceding search/media release.

Application revision `d75bbb80cbd83d81de0e9c34ed5b8734a3d1bab0` was deployed at
[Aria Hub](https://app.myariahub.com). Source is on `codex/universal-search` in
[PR #4](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/pull/4),
based on the existing Stitch branch. The prior application revision is
`22c709edfe740caa7cd3c98ceb6de0dbbf81cb79`. No new database migration was needed.

## Verified behavior

- The global desktop bar and mobile search entry open `/search`. People/accounts,
  posts, videos and topics can be filtered by category and platform without more
  provider calls. Native search links are provided for all ten platforms.
- A signed-in production search for NASA returned 20 account matches, two topics
  and two collected posts. Mastodon filtering returned nine actual profiles.
  Profiles retain provider handles and descriptions, including unofficial/mirror
  disclosures; the app does not invent verification badges or follower counts.
- Bluesky account search succeeded while its upstream post-search endpoint was
  partly unavailable. Available accounts and collected content remained visible.
- A real Bluesky video played automatically on the deployed site: muted, not
  paused, `readyState=4`, decoded size 720×1280, playback time above 67 seconds,
  and no media error. Playback uses the provider-owned public playlist, not a
  downloaded/rehosted original. Nineteen older cached video records were refreshed
  through the existing public metadata adapter, without errors or rate limits.
- Facebook photo previews render in the signed-in feed with the `Your Page`
  label. Read-only production Page queries returned HTTP 200 and actual photo,
  album and video attachments. Authorized Page videos play directly from the
  media URL returned by Graph, with the official player/original link as fallback.
  A real Page video decoded 720×1280 frames, played muted with `readyState=4`,
  advanced past two seconds and had no media error. No new permissions or extra
  per-video Graph calls were needed: the source is expanded with attachment
  metadata. Only provider-owned MP4 URLs without Graph credentials are accepted.
  Enabled cached sources contained 38 Facebook and 45 Bluesky video streams.

Coverage is intentionally explicit. Facebook reads connected Pages, Instagram
reads permitted connected professional-account content, and TikTok connection
remains gated pending its approved flow. This release does not provide their
personal Home/Explore/For You recommendation feeds. See
[search coverage and privacy](UNIVERSAL-SEARCH.md) and
[Feed capabilities](UNIVERSAL-FEED.md).

## Release checks

The exact application commit passed
[push verification](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/actions/runs/40907294401)
and [pull-request verification](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/actions/runs/40907307792):
254 application tests, 11 API browser cases, six demo browser cases, 29 operations
cases, four monitor cases, backend/web type checks, production builds, load checks,
and Linux container/migration/backup/restore checks. Dependency audit found zero
vulnerabilities. Lint has zero errors and the same 46 existing warnings.

Browser checks include actual H.264/fMP4 HLS decoding using a generated silent
fixture, progressive Facebook MP4 playback without an external iframe, single-player
lifecycle, pause on scroll, manual play with reduced motion,
responsive search at 320–1280px, privacy boundaries and provider failure behavior.

[Native ARM64 images](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/actions/runs/40907294219)
were built outside Oracle. Artifact digest, manifest checksums, source archive,
architecture and image revision labels matched the deployed commit. Deployment
used the shared operations lock, preserved rollback images and passed API, worker,
web, PostgreSQL and Caddy health checks before advancing `REVISION`.

Public HTTPS checks returned 200 for web/API health, Search, Feed, Accounts and
Inbox; unauthenticated search returned 401. The signed-in production browser also
verified the search and media flows.

## Data and operations

After deployment: four users, four workspaces, six social accounts, four media
assets, two posts, two remote posts, 123 Inbox items and 49 public tables. Required
record counts did not decrease. Uploaded-media aggregate SHA-256 remained
`3518665cac6eec0c8578c20654e64876373a2c531d57f3c98d9d75431a84853f`.
Protected older Aria Hub/SehatAI service PIDs/start times and independent database
container identities were unchanged.

Only disposable build output in five verified inactive SehatAI releases was
removed, freeing 176,377,856 bytes. The active SehatAI release, source, shared data,
older Aria Hub files and runtime images were preserved. Disk headroom remains low:
about 1.80 GB available and 97% used after the final release. Further capacity work
must preserve the protected older Aria Hub and the active SehatAI installation.

Pre-upgrade snapshot `backup-20261029T160556Z` authenticated locally. Post-upgrade
snapshot `backup-20261029T161212Z` authenticated locally and after download from
the existing private Google Drive backup folder. Its encrypted archive is 419,876
bytes, SHA-256 `6fd9b596bde1ce31b637b790c5ee3d672d16e4a3965ab5ac360062a6703305d5`.
The ignored recovery ledger preserves eight verified cloud snapshots. Keys and
credentials remain private. Backup timer and tunnel are active; the timer is
enabled.

The external scheduled uptime monitor recovered. Its latest completed
`production-health.yml` run is successful scheduled run `40903856679`, updated at
15:40:09 UTC on 29 October, about 36 minutes old when checked. The recovery is
recorded in the ignored backup ledger; a configured schedule alone is not counted
as proof of execution. The local backup uploader still requires this computer and Codex.

No social post, comment, follow or message was sent during this verification.
Private screenshots and operational outputs are in `.local/search-live-evidence/`
and the ignored recovery/deployment files.
