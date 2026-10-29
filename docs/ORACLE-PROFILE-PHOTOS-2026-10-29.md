# Provider profile pictures — Oracle release

Application `a6ad9b4716b7fa48a761eb4176a5d6ad0f034ddd` is live at
[Aria Hub](https://app.myariahub.com/feed), on `codex/universal-search` in
[PR #4](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/pull/4).
The rollback application is `d75bbb80cbd83d81de0e9c34ed5b8734a3d1bab0`.
No schema migration or additional provider permission was required.

## Change and verification

Meta account-feed adapters now request the authorized Page/account/profile picture
once per batch, alongside posts. Previously these adapters supplied no author
photo. Failed or timed-out profile reads leave posts available. Silhouettes,
unsafe URLs and URLs containing Graph credentials are omitted.

Post headers, Creator Spotlight and account search use a fixed circular avatar.
Failed images show initials without the content-preview error panel. Refreshed
URLs can load again. Search can fill a connected account's picture from the same
user's accessible cached author metadata.

- Real Facebook and Instagram profile metadata reads returned HTTP 200 with photos.
- After normal authorized source synchronization, all 72 active cached Facebook
  account-feed posts contained an author photo. One older record outside the
  current batch received the same author's photo from its own refreshed source;
  its expiry and other post fields were preserved.
- Three actual Page image requests returned HTTP 200 and image content, with
  4,172, 1,882 and 2,657 bytes. No private Graph token was sent to the image URLs.
- Browser regression tests verify a loaded image with nonzero intrinsic width,
  a 40×40 avatar, and initials after a failed image request. Search tests verify
  the connected-account picture while excluding other users/workspaces' content.
- Production web/API health returned HTTP 200 with PostgreSQL healthy, and the
  public Feed route returned HTTP 200. The API, worker, web and database containers
  passed deployment health checks.

[Push verification](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/actions/runs/40914426992),
[PR verification](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/actions/runs/40914437096)
and the [native ARM64 build](https://github.com/jamshidnabizada7-boop/SOCIAL-MEDIA-CONNECTOR/actions/runs/40914427177)
passed. Validation includes 258 application tests, 12 API browser cases, six demo
browser cases, type checks, builds, operations/monitor tests, load checks and
container/migration/backup/restore checks. Dependency audit reports zero
vulnerabilities. Lint retains 46 existing warnings and zero errors. One local
embedded-database browser run hit an unrelated workspace fixture error; its
isolated rerun and both native PostgreSQL CI runs passed.

The manual production browser reached sign-in after intermittent QUIC connection
errors, but its login request timed out from the local computer. A signed-in
production screenshot was therefore not obtained for this patch. Live metadata
and image requests above were checked from Oracle; rendering/fallback was checked
by the automated browser suite.

## Preservation and recovery

Before/after audits confirm the same four users, four workspaces, six social
accounts, four media assets, two posts, two remote posts, 123 Inbox items and
49 tables. Uploaded media hashes and protected older services/container identities
are unchanged. Previous runtime images and existing backups remain intact.

The artifact, source archive and image revision/architecture were verified before
deployment. Capacity was measured against new image layers with a 512 MiB reserve;
no existing application data or runtime images were deleted. Remaining root space
is approximately 1.2 GiB, so capacity remains constrained.

Post-release snapshot `backup-20261029T165322Z` was encrypted, authenticated,
uploaded to the existing private backup folder, downloaded through the connector
and SHA-256 verified. The append-only local recovery ledger records its Drive ID
and checksum. The backup timer is active/enabled and the tunnel is active.
