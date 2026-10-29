# Stitch design implementation — 29 October 2026

Design source: [Aria Hub Redesign in Google Stitch](https://stitch.withgoogle.com/projects/17270955137405194569).
All eight shared screens were inspected as rendered prototypes, including their
DOM-backed HTML, color definitions, typography and responsive layouts. The
private reference exports stay in the ignored `.local/stitch-reference` folder.

## Design plan and screen mapping

Use Inter for body text and Plus Jakarta Sans for headings, self-hosted through
Next's font build. Use the reference's emerald `#006948`, white surfaces, soft
lavender `#f1f3ff`, ink `#141b2b`, 12–16px card radii, 16px phone margins and 32px
desktop margins. Keep the full desktop Creator Suite sidebar, understated
search header, five-item mobile navigation and central emerald Create button.
Dark mode uses the reference's `#0b0f12` canvas and `#12181d` surfaces.

| Stitch screen | Application route | Implementation |
| --- | --- | --- |
| Universal Home Feed | `/feed` | Personal mixed feed, network pills, author cards, media, available engagement information and saved/followed state |
| Explore & Discover | `/explore` | Search/filter controls, topic chips, real returned creators in a horizontal Spotlight, masonry content cards |
| Full-Screen Video Feed | `/videos` and Feed → Videos | Dark portrait browsing, one active official player, author/caption, action rail, scroll/swipe/arrows/fullscreen |
| Create Post Composer | `/composer` | Media/Target/Schedule steps, media and caption editor, large destination cards, platform overrides, compatibility, previews and draft/publish/schedule actions |
| Creator Studio Hub | `/dashboard` | Launch/resume card, selectable week calendar, scheduled posts, weekly traction, connection issues and Studio module shortcuts |
| User Profile & Connected Accounts | `/accounts` | Actual signed-in identity and workspace, channel/health/post totals, profile/Studio/content links, connection cards, checks and reconnection |
| Social Inbox | `/inbox` on phones/tablets | Search, quick views, channel chips, advanced filters, conversation cards, thread/back navigation and dismissible context panel |
| Desktop Social Inbox (Split-Pane) | `/inbox` on wide screens | Conversation list, message/reply pane and creator/post/connection context column; two panes at intermediate desktop widths |

Calendar, Queue, Posts, Content, Team, Billing and Admin remain reachable under
More tools, the command palette and the full mobile navigation drawer. Channel
status and workspace switching remain available at the bottom of the desktop
sidebar. The workspace popup opens upward there so it stays inside the viewport.

The workspace list's `id` is normalized to the session contract's `workspaceId`.
Legacy `current` API paths and OAuth queries resolve to the selected membership's
UUID. Switching an API workspace recreates the page and service caches so an old
workspace's pending response cannot populate the new page. A workspace-list
outage keeps the authenticated membership from `/auth/me` usable and provides a
retry in the chooser; it does not invent alternative workspaces.

## Working behavior and accurate data

The design is connected to the existing Feed, accounts, media, posts, analytics
and Inbox services. Source permissions, original platform URLs, native players,
per-network compatibility, encrypted credentials, reply idempotency, ambiguous
delivery handling and workspace boundaries retain their existing behavior.
Changing workspaces remounts page state. The new conversation context panel
traps focus, closes with Escape/backdrop/Close and restores focus and scrolling.

The example identities, followers, dates and metrics in Stitch are replaced with
the active workspace's data. Missing metrics stay unavailable. Creator Spotlight
uses creators actually returned by the current sources; Follow and Save affect
Aria Hub's own personal feed. Sample content remains labelled in demo mode.

Stitch's simulated AI polish/assistant, sentiment score, collaboration funnel,
unapproved direct messages, fabricated engagement buttons, rate-card/email
actions and non-existent auto-sync toggles are not presented as working features.
The existing caption tools, supported interaction types, assignments, delivery
history and connection checks occupy those product areas. No new provider
permissions or public posting are required by the redesign.

Reference-only Tailwind browser scripts, editor injection scripts, purple
selection overlays, scrollbar suppression and global focus-outline suppression
were not included in the application. Existing accessible focus styles and
reduced-motion behavior are retained.

## Verification and release

The five demo browser tests cover the existing Feed and Inbox behavior plus
all seven routes at 320/390/768/1280/1600px, creator follow persistence, phone
navigation, context-panel dismissal/focus/draft retention, week selection and
destination selection. They assert that page content does not overflow the
viewport. The check found and fixed a long LinkedIn name expanding a phone grid.

API-backed publishing and Inbox regression results and the final CI evidence
are recorded with this change's pull request. These tests use isolated local
services and provider fixtures; they do not publish to production accounts.
Additional API browser cases create two isolated workspaces, verify that list
data and newly saved drafts belong to the selected one, and exercise recovery
from a failed workspace-list request.

This implementation is based on `codex/universal-feed` and requires that Feed
change first. It has not been deployed on Oracle. Production remains at the
previous deployed revision; the previously documented Oracle disk-headroom
release gate still applies. No production database, provider credentials,
backups, social content or OAuth settings were changed during this UI task.
