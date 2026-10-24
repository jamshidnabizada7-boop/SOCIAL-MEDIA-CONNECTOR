import type {
  AuditEntry,
  Brand,
  FeatureFlag,
  Invoice,
  MediaAsset,
  Notification,
  Plan,
  Post,
  PublishTarget,
  QueueSlot,
  SocialAccount,
  Subscription,
  TopPost,
  Usage,
  User,
  Workspace,
  ProviderId,
  AdminProvider,
  AdminJob,
  WebhookEvent,
} from "../types";

const now = Date.now();
const H = 3600_000;
const D = 24 * H;
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
const ago = (ms: number) => iso(-ms);

/* ---------------------------------- Users --------------------------------- */

export const CURRENT_USER_ID = "usr_maya";

export const USERS: User[] = [
  { id: "usr_maya", name: "Maya Chen", email: "maya@ariahub.co", avatarHue: 160, role: "owner", isAdmin: true, lastActiveAt: iso(-2 * 60000), status: "active" },
  { id: "usr_devon", name: "Devon Park", email: "devon@ariahub.co", avatarHue: 260, role: "manager", lastActiveAt: ago(3 * H), status: "active" },
  { id: "usr_ines", name: "Inés Rojas", email: "ines@ariahub.co", avatarHue: 20, role: "editor", lastActiveAt: ago(26 * H), status: "active" },
  { id: "usr_tomas", name: "Tomás Weber", email: "tomas@ariahub.co", avatarHue: 200, role: "approver", lastActiveAt: ago(2 * D), status: "active" },
  { id: "usr_sara", name: "Sara Lindqvist", email: "sara@ariahub.co", avatarHue: 300, role: "viewer", lastActiveAt: ago(9 * D), status: "active" },
  { id: "usr_jun", name: "Jun Sato", email: "jun@northwind.agency", avatarHue: 40, role: "editor", lastActiveAt: ago(5 * H), status: "invited" },
];

/* -------------------------------- Workspaces ------------------------------ */

export const BRANDS: Brand[] = [
  { id: "brand_aria", name: "Aria Hub", hue: 162, description: "The main product brand — consumer social presence." },
  { id: "brand_studio", name: "Studio Nights", hue: 285, description: "Community and events sub-brand." },
];

export const WORKSPACES: Workspace[] = [
  {
    id: "ws_aria",
    name: "Aria Studio",
    timezone: "Europe/Berlin",
    locale: "en",
    plan: "pro",
    brands: BRANDS,
    createdAt: ago(420 * D),
  },
  {
    id: "ws_north",
    name: "Northwind Agency",
    timezone: "America/New_York",
    locale: "en",
    plan: "agency",
    brands: [{ id: "brand_nw", name: "Northwind Clients", hue: 210 }],
    createdAt: ago(120 * D),
  },
];

/* --------------------------------- Accounts ------------------------------- */

function acc(
  id: string,
  provider: ProviderId,
  brandId: string,
  displayName: string,
  handle: string,
  avatarHue: number,
  followers: number,
  connection: SocialAccount["connection"],
  connectedDays: number,
  connectionNote?: string,
  tokenDaysLeft?: number
): SocialAccount {
  return {
    id,
    provider,
    brandId,
    displayName,
    handle,
    avatarHue,
    connection,
    connectionNote,
    followers,
    connectedAt: ago(connectedDays * D),
    lastRefreshedAt: ago(connection === "healthy" ? 2 * H : 26 * H),
    tokenExpiresAt: tokenDaysLeft !== undefined ? iso(tokenDaysLeft * D) : undefined,
    scopes: providerScopes(provider),
  };
}

function providerScopes(p: ProviderId): string[] {
  switch (p) {
    case "instagram":
      return ["instagram_basic", "instagram_content_publish", "instagram_manage_insights", "pages_show_list"];
    case "facebook":
      return ["pages_manage_posts", "pages_read_engagement", "pages_show_list"];
    case "linkedin":
      return ["w_member_social", "rw_organization_admin"];
    case "tiktok":
      return ["video.upload", "video.publish", "user.info.basic"];
    case "youtube":
      return ["youtube.upload", "youtube.readonly"];
    case "threads":
      return ["threads_basic", "threads_content_publish"];
    case "x":
      return ["tweet.read", "tweet.write", "users.read", "offline.access"];
    case "pinterest":
      return ["pins:write", "boards:read", "user_accounts:read"];
    case "bluesky":
      return ["app password"];
    case "mastodon":
      return ["read", "write", "push"];
  }
}

export const ACCOUNTS: SocialAccount[] = [
  acc("acc_fb", "facebook", "brand_aria", "ARIA HUB", "facebook.com/ariahub", 214, 128400, "healthy", 310),
  acc("acc_ig", "instagram", "brand_aria", "ARIA HUB", "@myariahub", 328, 89200, "healthy", 310),
  acc("acc_li", "linkedin", "brand_aria", "Aria Hub · Company", "linkedin.com/company/ariahub", 210, 34700, "healthy", 280),
  acc("acc_tt", "tiktok", "brand_aria", "ARIA HUB", "@myariahub", 186, 152300, "needs_reauth", 96, "TikTok revoked access on Sep 12. Reconnect to publish again."),
  acc("acc_yt", "youtube", "brand_aria", "ARIA HUB", "youtube.com/@ariahub", 0, 48100, "healthy", 250),
  acc("acc_th", "threads", "brand_aria", "ARIA HUB", "@myariahub", 262, 21500, "healthy", 60),
  acc("acc_x", "x", "brand_aria", "ARIA HUB", "@ariahub", 342, 42600, "healthy", 300),
  acc("acc_pin", "pinterest", "brand_aria", "ARIA HUB", "pinterest.com/ariahub", 354, 12300, "healthy", 180),
  acc("acc_bsky", "bluesky", "brand_aria", "ARIA HUB", "@ariahub.bsky.social", 205, 6400, "healthy", 45),
  acc("acc_mas", "mastodon", "brand_aria", "ARIA HUB", "@ariahub@mastodon.social", 250, 3100, "token_expiring", 45, "Access token expires in 6 days. We will refresh it automatically.", 6),
  acc("acc_ig2", "instagram", "brand_studio", "Studio Nights", "@studionights", 285, 9800, "healthy", 90),
  acc("acc_pin2", "pinterest", "brand_studio", "Studio Nights", "pinterest.com/studionights", 280, 4100, "healthy", 90),
];

/* ---------------------------------- Media --------------------------------- */

function media(
  id: string,
  kind: MediaAsset["kind"],
  filename: string,
  bytes: number,
  hue: number,
  dims: [number, number] | undefined,
  durationSec: number | undefined,
  tags: string[],
  createdDays: number,
  usedInCount: number,
  altText?: string
): MediaAsset {
  const mime = kind === "image" ? "image/jpeg" : kind === "video" ? "video/mp4" : "application/pdf";
  const [width, height] = dims ?? [0, 0];
  return {
    id,
    kind,
    filename,
    bytes,
    mime,
    detectedMime: mime,
    width: dims ? width : undefined,
    height: dims ? height : undefined,
    aspectRatio: dims ? simplifyRatio(width, height) : undefined,
    durationSec,
    codec: kind === "video" ? "h264" : undefined,
    audioCodec: kind === "video" ? "aac" : undefined,
    fps: kind === "video" ? 30 : undefined,
    checksum: `sha256:${id.slice(-8)}${filename.length.toString(16)}`,
    altText,
    hue,
    tags,
    status: "ready",
    createdAt: ago(createdDays * D),
    usedInCount,
  };
}

function simplifyRatio(w: number, h: number): string {
  const r = w / h;
  const known: [number, string][] = [
    [1, "1:1"],
    [4 / 5, "4:5"],
    [5 / 4, "5:4"],
    [16 / 9, "16:9"],
    [9 / 16, "9:16"],
    [2 / 3, "2:3"],
    [3 / 4, "3:4"],
  ];
  for (const [v, label] of known) if (Math.abs(r - v) < 0.02) return label;
  return `${w}:${h}`;
}

export const MEDIA: MediaAsset[] = [
  media("med_hero", "image", "launch-hero.jpg", 2_400_000, 162, [3024, 3024], undefined, ["launch"], 3, 3, "Team raising the new product box in a bright studio."),
  media("med_demo", "video", "product-demo-30s.mp4", 48_600_000, 205, [1080, 1920], 31, ["launch", "video"], 3, 2, undefined),
  media("med_team", "image", "team-photo.jpg", 3_100_000, 30, [4032, 3024], undefined, ["team"], 12, 1, "Five teammates laughing at a whiteboard covered in sticky notes."),
  media("med_carousel1", "image", "tip-slide-1.png", 640_000, 260, [1080, 1350], undefined, ["tips"], 8, 2, "Slide one: a single bold tip on a dark background."),
  media("med_carousel2", "image", "tip-slide-2.png", 610_000, 268, [1080, 1350], undefined, ["tips"], 8, 2, "Slide two: the same tip shown as a checklist."),
  media("med_carousel3", "image", "tip-slide-3.png", 590_000, 276, [1080, 1350], undefined, ["tips"], 8, 1, "Slide three: call to action with the product name."),
  media("med_quote", "image", "quote-card.png", 420_000, 22, [1080, 1080], undefined, ["quotes"], 6, 2, "Quote card: consistency beats intensity."),
  media("med_recap", "video", "event-recap-90s.mp4", 132_000_000, 300, [1920, 1080], 92, ["events"], 5, 1, undefined),
  media("med_reel", "video", "bts-reel-18s.mp4", 21_400_000, 336, [1080, 1920], 18, ["bts"], 4, 1, undefined),
  media("med_brandfilm", "video", "brand-film-11min.mp4", 940_000_000, 118, [3840, 2160], 663, ["film"], 2, 0, undefined),
  media("med_lookbook", "document", "spring-lookbook.pdf", 8_300_000, 62, undefined, undefined, ["print"], 15, 1, undefined),
  media("med_office", "image", "office-morning.jpg", 2_800_000, 84, [3024, 4032], undefined, ["team"], 20, 0, "Morning light across an empty studio desk."),
];

/* ---------------------------------- Posts --------------------------------- */

function target(
  id: string,
  accountId: string,
  provider: ProviderId,
  state: PublishTarget["state"],
  opts?: Partial<PublishTarget>
): PublishTarget {
  return {
    id,
    accountId,
    provider,
    state,
    attempts: 1,
    idempotencyKey: `idem_${id}`,
    ...opts,
  };
}

export const POSTS: Post[] = [
  {
    id: "pst_launch_video",
    title: "Launch film — main announcement",
    caption:
      "It's here. Meet the new Aria Hub — plan a week of content in one sitting, publish it everywhere in one click.\n\nLink in bio for the full tour. #CreateOnce #PublishEverywhere",
    mediaIds: ["med_demo", "med_hero"],
    state: "scheduled",
    brandId: "brand_aria",
    authorId: "usr_maya",
    campaign: "Spring launch",
    labels: ["hero", "video"],
    timezone: "Europe/Berlin",
    scheduledAt: iso(26 * H),
    createdAt: ago(2 * D),
    updatedAt: ago(5 * H),
    variants: [
      {
        provider: "youtube",
        title: "Introducing the new Aria Hub (2-minute tour)",
        settings: { visibility: "public", madeForKids: false, category: "Science & Technology", tags: ["product", "saas"] },
      },
      {
        provider: "tiktok",
        settings: { privacyOption: "public", allowComments: true },
      },
    ],
    versions: [{ version: 2, frozenAt: ago(5 * H), caption: "(scheduled snapshot)", mediaIds: ["med_demo", "med_hero"], byUserId: "usr_maya" }],
    targets: [
      target("tgt_lv_ig", "acc_ig", "instagram", "pending", { scheduledAt: iso(26 * H) }),
      target("tgt_lv_fb", "acc_fb", "facebook", "pending", { scheduledAt: iso(26 * H) }),
      target("tgt_lv_tt", "acc_tt", "tiktok", "pending", { scheduledAt: iso(26 * H) }),
      target("tgt_lv_yt", "acc_yt", "youtube", "pending", { scheduledAt: iso(26 * H) }),
      target("tgt_lv_th", "acc_th", "threads", "pending", { scheduledAt: iso(26 * H) }),
    ],
  },
  {
    id: "pst_tips",
    title: "Weekly tip carousel #14",
    caption:
      "Batching beats multitasking. Here's the 3-slide system our team uses to plan a week of content in 40 minutes. Save this one. #ContentTips",
    mediaIds: ["med_carousel1", "med_carousel2", "med_carousel3"],
    state: "scheduled",
    brandId: "brand_aria",
    authorId: "usr_ines",
    campaign: "Evergreen tips",
    labels: ["carousel"],
    timezone: "Europe/Berlin",
    scheduledAt: iso(2 * D + 9 * H),
    createdAt: ago(3 * D),
    updatedAt: ago(1 * D),
    variants: [{ provider: "linkedin", caption: "Batching beats multitasking. The 3-slide system our team uses to plan a week of content in 40 minutes — explained in the carousel below.", firstComment: "What does your Monday planning look like?", settings: {} }],
    targets: [
      target("tgt_tp_ig", "acc_ig", "instagram", "pending", { scheduledAt: iso(2 * D + 9 * H) }),
      target("tgt_tp_li", "acc_li", "linkedin", "pending", { scheduledAt: iso(2 * D + 9 * H) }),
      target("tgt_tp_pin", "acc_pin", "pinterest", "pending", { scheduledAt: iso(2 * D + 9 * H) }),
    ],
  },
  {
    id: "pst_quote",
    title: "Quote card — consistency",
    caption: "Consistency beats intensity. Show up, ship, repeat. #CreatorLife",
    mediaIds: ["med_quote"],
    state: "scheduled",
    brandId: "brand_aria",
    authorId: "usr_devon",
    labels: ["quote"],
    timezone: "Europe/Berlin",
    scheduledAt: iso(3 * D + 8 * H),
    createdAt: ago(4 * D),
    updatedAt: ago(4 * D),
    variants: [{ provider: "pinterest", settings: { boardId: "brd_quotes" } }],
    targets: [
      target("tgt_qt_ig", "acc_ig", "instagram", "pending", { scheduledAt: iso(3 * D + 8 * H) }),
      target("tgt_qt_x", "acc_x", "x", "pending", { scheduledAt: iso(3 * D + 8 * H) }),
      target("tgt_qt_pin", "acc_pin", "pinterest", "pending", { scheduledAt: iso(3 * D + 8 * H) }),
    ],
  },
  {
    id: "pst_hiring",
    title: "We're hiring a content designer",
    caption:
      "We're looking for a content designer who thinks in systems and writes like a human. Remote (EU time zones). Full role and application on our careers page.",
    mediaIds: [],
    state: "scheduled",
    brandId: "brand_aria",
    authorId: "usr_maya",
    labels: ["hiring"],
    timezone: "Europe/Berlin",
    scheduledAt: iso(4 * D + 11 * H),
    createdAt: ago(6 * H),
    updatedAt: ago(6 * H),
    targets: [target("tgt_hr_li", "acc_li", "linkedin", "pending", { scheduledAt: iso(4 * D + 11 * H) })],
  },
  {
    id: "pst_recap",
    title: "Community meetup recap",
    caption: "120 people, 6 talks, one very good cake. Thank you to everyone who came to the Berlin meetup — recap film inside. #Community",
    mediaIds: ["med_recap"],
    state: "processing",
    brandId: "brand_aria",
    authorId: "usr_devon",
    campaign: "Events",
    labels: ["recap"],
    timezone: "Europe/Berlin",
    createdAt: ago(40 * 60000),
    updatedAt: ago(38 * 60000),
    targets: [
      target("tgt_rc_ig", "acc_ig2", "instagram", "published", { publishedAt: ago(60_000) }),
      target("tgt_rc_yt", "acc_yt", "youtube", "provider_processing", { progress: 80 }),
      target("tgt_rc_li", "acc_li", "linkedin", "publishing", { progress: 55 }),
      target("tgt_rc_th", "acc_th", "threads", "uploading_media", { progress: 30 }),
    ],
  },
  {
    id: "pst_spotlight",
    title: "Feature spotlight — compatibility engine",
    caption:
      "New in Aria Hub: the compatibility engine checks every destination before you publish, and suggests safe fixes — crops, trims, transcodes. No more surprise failures at 6pm. #ProductUpdate",
    mediaIds: ["med_hero"],
    state: "partially_published",
    brandId: "brand_aria",
    authorId: "usr_maya",
    campaign: "Spring launch",
    labels: ["feature"],
    timezone: "Europe/Berlin",
    createdAt: ago(2 * D),
    updatedAt: ago(1 * D),
    publishedAt: ago(1 * D),
    targets: [
      target("tgt_sp_fb", "acc_fb", "facebook", "published", { publishedAt: ago(1 * D), remoteUrl: "https://facebook.com/ariahub/posts/10241" }),
      target("tgt_sp_ig", "acc_ig", "instagram", "published", { publishedAt: ago(1 * D), remoteUrl: "https://instagram.com/p/aria10241" }),
      target("tgt_sp_li", "acc_li", "linkedin", "published", { publishedAt: ago(1 * D), remoteUrl: "https://linkedin.com/posts/ariahub_10241" }),
      target("tgt_sp_tt", "acc_tt", "tiktok", "token_expired", {
        attempts: 3,
        lastError: {
          code: "tiktok_auth_revoked",
          title: "TikTok access was revoked",
          message: "This account needs to be reconnected before we can publish.",
          hint: "Reconnecting takes about a minute and keeps your scheduled content.",
          retryable: true,
          technical: "403 · {\"error\":{\"code\":\"access_token_invalid\",\"description\":\"The user revoked access.\"}}",
        },
      }),
      target("tgt_sp_yt", "acc_yt", "youtube", "failed", {
        attempts: 2,
        lastError: {
          code: "youtube_title_missing",
          title: "YouTube needs a title",
          message: "Videos on YouTube require a title of up to 100 characters.",
          hint: "Add a title in the YouTube variant of this post.",
          retryable: true,
          technical: "400 · invalidVideoMetadata: title.required",
        },
      }),
    ],
  },
  {
    id: "pst_bts",
    title: "Behind the scenes reel",
    caption: "One take, zero notes. The way the studio looked 10 minutes before we hit record. #BTS",
    mediaIds: ["med_reel"],
    state: "published",
    brandId: "brand_aria",
    authorId: "usr_ines",
    labels: ["bts"],
    timezone: "Europe/Berlin",
    createdAt: ago(4 * D),
    updatedAt: ago(3 * D),
    publishedAt: ago(3 * D),
    targets: [
      target("tgt_bts_ig", "acc_ig", "instagram", "published", { publishedAt: ago(3 * D), remoteUrl: "https://instagram.com/reel/aria9912" }),
      target("tgt_bts_fb", "acc_fb", "facebook", "published", { publishedAt: ago(3 * D), remoteUrl: "https://facebook.com/ariahub/posts/10188" }),
    ],
  },
  {
    id: "pst_blog",
    title: "New blog post — multi-tenant media pipeline",
    caption:
      "We wrote about the media pipeline behind Aria Hub: inspection, derivatives, and why the original upload is never destroyed. Read it on the blog → ariahub.co/blog/media-pipeline",
    mediaIds: [],
    link: "https://ariahub.co/blog/media-pipeline",
    state: "published",
    brandId: "brand_aria",
    authorId: "usr_maya",
    labels: ["blog"],
    timezone: "Europe/Berlin",
    createdAt: ago(2 * D),
    updatedAt: ago(1.5 * D),
    publishedAt: ago(1.5 * D),
    targets: [
      target("tgt_bl_x", "acc_x", "x", "published", { publishedAt: ago(1.5 * D), remoteUrl: "https://x.com/ariahub/status/1772" }),
      target("tgt_bl_bsky", "acc_bsky", "bluesky", "published", { publishedAt: ago(1.5 * D) }),
      target("tgt_bl_mas", "acc_mas", "mastodon", "published", { publishedAt: ago(1.5 * D) }),
      target("tgt_bl_th", "acc_th", "threads", "published", { publishedAt: ago(1.5 * D) }),
    ],
  },
  {
    id: "pst_customer",
    title: "Customer story — Northwind",
    caption: "Northwind Agency runs 40+ client channels through Aria Hub. \"One composer instead of ten browser tabs.\" Full story on the blog. #CustomerStory",
    mediaIds: ["med_team"],
    state: "published",
    brandId: "brand_aria",
    authorId: "usr_tomas",
    labels: ["story"],
    timezone: "Europe/Berlin",
    createdAt: ago(14 * D),
    updatedAt: ago(13 * D),
    publishedAt: ago(13 * D),
    targets: [
      target("tgt_cs_li", "acc_li", "linkedin", "published", { publishedAt: ago(13 * D) }),
      target("tgt_cs_x", "acc_x", "x", "published", { publishedAt: ago(13 * D) }),
      target("tgt_cs_fb", "acc_fb", "facebook", "published", { publishedAt: ago(13 * D) }),
    ],
  },
  {
    id: "pst_film",
    title: "Brand film — long cut",
    caption: "Eleven minutes on how we build. For the channels that want the whole story.",
    mediaIds: ["med_brandfilm"],
    state: "failed",
    brandId: "brand_aria",
    authorId: "usr_maya",
    labels: ["film"],
    timezone: "Europe/Berlin",
    createdAt: ago(2 * D),
    updatedAt: ago(1.2 * D),
    targets: [
      target("tgt_film_yt", "acc_yt", "youtube", "published", { publishedAt: ago(1.2 * D), remoteUrl: "https://youtube.com/watch?v=ariaFilm" }),
      target("tgt_film_tt", "acc_tt", "tiktok", "failed", {
        attempts: 2,
        lastError: {
          code: "tiktok_duration_limit",
          title: "Video is too long for TikTok",
          message: "This video is 11:03. TikTok accepts videos up to 10 minutes.",
          hint: "We can create a trimmed derivative for TikTok without touching the original.",
          retryable: false,
          technical: "400 · video_duration_exceeds_limit (max 600s)",
        },
      }),
      target("tgt_film_mas", "acc_mas", "mastodon", "failed", {
        attempts: 2,
        lastError: {
          code: "mastodon_media_too_large",
          title: "The instance rejected the upload",
          message: "mastodon.social declined the video: file exceeds this server's size limit.",
          hint: "Compressing the video should bring it under the server limit.",
          retryable: true,
          technical: "422 · ValidationError: File content type is invalid / size 940MB > 250MB",
        },
      }),
    ],
  },
  {
    id: "pst_teaser",
    title: "April teaser (pulled)",
    caption: "Something small is coming.",
    mediaIds: ["med_office"],
    state: "canceled",
    brandId: "brand_aria",
    authorId: "usr_ines",
    timezone: "Europe/Berlin",
    createdAt: ago(20 * D),
    updatedAt: ago(19 * D),
    targets: [target("tgt_ts_ig", "acc_ig", "instagram", "canceled")],
  },
  {
    id: "pst_draft_teaser",
    title: "Spring launch teaser",
    caption: "One week from today, everything gets a little lighter. #CreateOnce",
    mediaIds: ["med_hero"],
    state: "draft",
    brandId: "brand_aria",
    authorId: "usr_maya",
    campaign: "Spring launch",
    labels: ["teaser"],
    timezone: "Europe/Berlin",
    createdAt: ago(1 * D),
    updatedAt: ago(3 * H),
    variants: [],
    targets: [
      target("tgt_dr_ig", "acc_ig", "instagram", "pending"),
      target("tgt_dr_fb", "acc_fb", "facebook", "pending"),
    ],
  },
  {
    id: "pst_draft_thread",
    title: "Behind the build — thread",
    caption:
      "We rebuilt our publishing engine three times. Here's what we learned about retries, idempotency and never publishing the same post twice: 🧵",
    mediaIds: [],
    state: "draft",
    brandId: "brand_aria",
    authorId: "usr_maya",
    labels: ["thread"],
    timezone: "Europe/Berlin",
    createdAt: ago(6 * H),
    updatedAt: ago(2 * H),
    targets: [
      target("tgt_dt_x", "acc_x", "x", "pending"),
      target("tgt_dt_th", "acc_th", "threads", "pending"),
      target("tgt_dt_bsky", "acc_bsky", "bluesky", "pending"),
    ],
  },
  {
    id: "pst_studio_night",
    title: "Open studio night — invite",
    caption: "Open Studio Night returns next Thursday. Live sets, prints on the wall, good coffee. RSVP in bio.",
    mediaIds: ["med_office"],
    state: "scheduled",
    brandId: "brand_studio",
    authorId: "usr_devon",
    campaign: "Events",
    labels: ["invite"],
    timezone: "Europe/Berlin",
    scheduledAt: iso(5 * D + 17 * H),
    createdAt: ago(2 * D),
    updatedAt: ago(1 * D),
    variants: [{ provider: "pinterest", settings: { boardId: "brd_events" } }],
    targets: [
      target("tgt_os_ig2", "acc_ig2", "instagram", "pending", { scheduledAt: iso(5 * D + 17 * H) }),
      target("tgt_os_pin2", "acc_pin2", "pinterest", "pending", { scheduledAt: iso(5 * D + 17 * H) }),
    ],
  },
];

/* ------------------------------- Queue slots ------------------------------ */

export const QUEUE_SLOTS: QueueSlot[] = [
  { id: "qs_1", dayOfWeek: 1, time: "09:00", providerIds: ["instagram", "facebook"], enabled: true },
  { id: "qs_2", dayOfWeek: 1, time: "18:00", providerIds: ["tiktok", "youtube"], enabled: true },
  { id: "qs_3", dayOfWeek: 3, time: "12:30", providerIds: ["linkedin"], enabled: true },
  { id: "qs_4", dayOfWeek: 5, time: "17:00", providerIds: ["instagram", "threads"], enabled: false },
];

/* ------------------------------- Notifications ---------------------------- */

export const NOTIFICATIONS: Notification[] = [
  {
    id: "ntf_1",
    type: "needs_reauth",
    title: "TikTok needs to be reconnected",
    body: "Access was revoked on Sep 12. Scheduled TikTok content will fail until you reconnect.",
    createdAt: ago(4 * H),
    read: false,
    severity: "warning",
    accountId: "acc_tt",
  },
  {
    id: "ntf_2",
    type: "post_failed",
    title: "“Brand film — long cut” needs attention",
    body: "2 of 3 destinations failed. TikTok: video too long · Mastodon: file too large for the instance.",
    createdAt: ago(1.2 * D),
    read: false,
    severity: "error",
    postId: "pst_film",
  },
  {
    id: "ntf_3",
    type: "needs_action",
    title: "YouTube requires a title",
    body: "“Feature spotlight” couldn't publish to YouTube. Add a title in the YouTube variant and retry.",
    createdAt: ago(1 * D),
    read: false,
    severity: "warning",
    postId: "pst_spotlight",
  },
  {
    id: "ntf_4",
    type: "retry_succeeded",
    title: "Retry succeeded",
    body: "“Customer story” published to Facebook after a failed first attempt.",
    createdAt: ago(2 * D),
    read: true,
    severity: "success",
    postId: "pst_customer",
  },
  {
    id: "ntf_5",
    type: "schedule_conflict",
    title: "Two posts share the same slot",
    body: "“Weekly tip carousel” and “Quote card” are both scheduled for the same Instagram time slot on Thursday.",
    createdAt: ago(2.5 * D),
    read: true,
    severity: "info",
  },
  {
    id: "ntf_6",
    type: "team_invite",
    title: "Jun Sato accepted your invitation",
    body: "Jun joined Northwind Agency as an editor.",
    createdAt: ago(3 * D),
    read: true,
    severity: "success",
  },
  {
    id: "ntf_7",
    type: "billing",
    title: "Receipt for September",
    body: "Your Pro plan receipt (#AR-2026-09) is available in Billing.",
    createdAt: ago(5 * D),
    read: true,
    severity: "info",
  },
  {
    id: "ntf_8",
    type: "post_published",
    title: "“Behind the scenes reel” published",
    body: "Published to Instagram and Facebook.",
    createdAt: ago(3 * D),
    read: true,
    severity: "success",
    postId: "pst_bts",
  },
];

/* --------------------------------- Billing -------------------------------- */

export const SUBSCRIPTION: Subscription = {
  plan: {
    id: "pro",
    name: "Pro",
    priceMonthly: 49,
    channels: 25,
    brands: 10,
    members: 10,
    scheduledPostsPerMonth: "unlimited",
    storageGb: 250,
    aiCredits: 2000,
    highlights: [
      "25 connected channels",
      "10 brands and 10 team seats",
      "Unlimited scheduled posts",
      "250 GB media storage",
      "2,000 AI adaptation credits / month",
      "API access (beta)",
    ],
  },
  renewsAt: iso(18 * D),
  paymentBrand: "Visa",
  paymentLast4: "4242",
  seats: 5,
};

export const USAGE: Usage = {
  channels: { used: 12, limit: 25 },
  brands: { used: 2, limit: 10 },
  members: { used: 5, limit: 10 },
  scheduledPosts: { used: 4, limit: "unlimited" },
  storage: { usedGb: 41.6, limitGb: 250 },
  aiCredits: { used: 386, limit: 2000 },
};

export const INVOICES: Invoice[] = [
  { id: "inv_4", number: "AR-2026-09", date: ago(5 * D), amount: 49, status: "paid", planName: "Pro" },
  { id: "inv_3", number: "AR-2026-08", date: ago(35 * D), amount: 49, status: "paid", planName: "Pro" },
  { id: "inv_2", number: "AR-2026-07", date: ago(65 * D), amount: 49, status: "paid", planName: "Pro" },
  { id: "inv_1", number: "AR-2026-06", date: ago(95 * D), amount: 19, status: "paid", planName: "Creator" },
];

/* ---------------------------------- Admin --------------------------------- */

export const ADMIN_PROVIDERS: AdminProvider[] = [
  { provider: "instagram", status: "active", apiVersion: "v23.0", approval: "approved", errorRate7d: 0.4, lastSuccessfulPublish: ago(26 * H), rateLimitHealth: "normal" },
  { provider: "facebook", status: "active", apiVersion: "v23.0", approval: "approved", errorRate7d: 0.2, lastSuccessfulPublish: ago(1 * D), rateLimitHealth: "normal" },
  { provider: "threads", status: "active", apiVersion: "v1.0", approval: "approved", errorRate7d: 0.9, lastSuccessfulPublish: ago(1.5 * D), rateLimitHealth: "normal" },
  { provider: "linkedin", status: "active", apiVersion: "202609", approval: "approved", errorRate7d: 0.6, lastSuccessfulPublish: ago(26 * H), rateLimitHealth: "normal" },
  { provider: "tiktok", status: "degraded", apiVersion: "v3", approval: "pending", errorRate7d: 6.8, lastSuccessfulPublish: ago(6 * D), rateLimitHealth: "elevated" },
  { provider: "youtube", status: "active", apiVersion: "v3 (2026-04)", approval: "testing", errorRate7d: 1.4, lastSuccessfulPublish: ago(1.2 * D), rateLimitHealth: "normal" },
  { provider: "x", status: "active", apiVersion: "v2", approval: "approved", errorRate7d: 0.8, lastSuccessfulPublish: ago(1.5 * D), rateLimitHealth: "normal" },
  { provider: "pinterest", status: "active", apiVersion: "v5", approval: "approved", errorRate7d: 0.3, lastSuccessfulPublish: ago(3 * D), rateLimitHealth: "normal" },
  { provider: "bluesky", status: "active", apiVersion: "atproto", approval: "approved", errorRate7d: 0.1, lastSuccessfulPublish: ago(1.5 * D), rateLimitHealth: "normal" },
  { provider: "mastodon", status: "maintenance", apiVersion: "v4.3", approval: "approved", errorRate7d: 2.2, lastSuccessfulPublish: ago(1.5 * D), rateLimitHealth: "normal" },
];

export const ADMIN_JOBS: AdminJob[] = [
  { id: "job_1", postId: "pst_recap", postTitle: "Community meetup recap", provider: "youtube", state: "provider_processing", attempts: 1, queuedAt: ago(40 * 60000) },
  { id: "job_2", postId: "pst_recap", postTitle: "Community meetup recap", provider: "linkedin", state: "publishing", attempts: 1, queuedAt: ago(40 * 60000) },
  { id: "job_3", postId: "pst_spotlight", postTitle: "Feature spotlight — compatibility engine", provider: "tiktok", state: "token_expired", attempts: 3, queuedAt: ago(1.1 * D), lastError: "tiktok_auth_revoked" },
  { id: "job_4", postId: "pst_film", postTitle: "Brand film — long cut", provider: "mastodon", state: "failed", attempts: 2, queuedAt: ago(1.2 * D), lastError: "mastodon_media_too_large" },
  { id: "job_5", postId: "pst_launch_video", postTitle: "Launch film — main announcement", provider: "instagram", state: "queued", attempts: 0, queuedAt: iso(26 * H) },
];

export const DLQ: AdminJob[] = [
  { id: "dlq_1", postId: "pst_film", postTitle: "Brand film — long cut", provider: "tiktok", state: "failed", attempts: 5, queuedAt: ago(1.2 * D), lastError: "video_duration_exceeds_limit" },
  { id: "dlq_2", postId: "pst_spotlight", postTitle: "Feature spotlight — compatibility engine", provider: "youtube", state: "failed", attempts: 4, queuedAt: ago(1 * D), lastError: "title.required" },
];

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  { id: "wh_1", provider: "tiktok", type: "video.publish.completed", receivedAt: ago(20 * 60000), verified: true, processed: "processed" },
  { id: "wh_2", provider: "tiktok", type: "video.publish.completed", receivedAt: ago(20 * 60000), verified: true, processed: "duplicate" },
  { id: "wh_3", provider: "instagram", type: "media.status.updated", receivedAt: ago(55 * 60000), verified: true, processed: "processed" },
  { id: "wh_4", provider: "youtube", type: "video.processingFinished", receivedAt: ago(2 * H), verified: true, processed: "processed" },
  { id: "wh_5", provider: "facebook", type: "feed.status", receivedAt: ago(3 * H), verified: false, processed: "failed" },
  { id: "wh_6", provider: "linkedin", type: "organization.socialAction", receivedAt: ago(5 * H), verified: true, processed: "processed" },
];

export const FEATURE_FLAGS: FeatureFlag[] = [
  { key: "provider_tiktok_direct_publish", description: "TikTok Direct Post for audited apps (otherwise upload-as-draft).", enabled: false, rollout: "internal" },
  { key: "provider_youtube_publish", description: "YouTube publishing pipeline (pending API audit).", enabled: true, rollout: "beta" },
  { key: "ai_caption_adaptation", description: "“Adapt for each network” in the composer.", enabled: true, rollout: "all" },
  { key: "analytics_v2", description: "Normalized analytics warehouse and comparisons.", enabled: false, rollout: "percentage" },
  { key: "approval_workflows", description: "Draft → review → approved flow for workspaces.", enabled: true, rollout: "beta" },
];

export const AUDIT_LOG: AuditEntry[] = [
  { id: "aud_1", at: ago(30 * 60000), actor: "Maya Chen", action: "post.scheduled", target: "Launch film — main announcement", workspace: "Aria Studio", ip: "84.112.9.201" },
  { id: "aud_2", at: ago(5 * H), actor: "Inés Rojas", action: "post.updated", target: "Spring launch teaser", workspace: "Aria Studio", ip: "84.112.9.44" },
  { id: "aud_3", at: ago(1.1 * D), actor: "System", action: "publish.retry_exhausted", target: "Feature spotlight → YouTube", workspace: "Aria Studio", ip: "—" },
  { id: "aud_4", at: ago(1 * D), actor: "Maya Chen", action: "account.connected", target: "Threads · @myariahub", workspace: "Aria Studio", ip: "84.112.9.201" },
  { id: "aud_5", at: ago(1.2 * D), actor: "Devon Park", action: "post.published", target: "Customer story — Northwind", workspace: "Aria Studio", ip: "77.20.4.19" },
  { id: "aud_6", at: ago(3 * D), actor: "Maya Chen", action: "member.invited", target: "jun@northwind.agency (editor)", workspace: "Northwind Agency", ip: "84.112.9.201" },
  { id: "aud_7", at: ago(6 * D), actor: "Maya Chen", action: "billing.plan_changed", target: "Creator → Pro", workspace: "Aria Studio", ip: "84.112.9.201" },
  { id: "aud_8", at: ago(7 * D), actor: "System", action: "credential.refreshed", target: "Instagram · @myariahub", workspace: "Aria Studio", ip: "—" },
];

/* --------------------------------- Analytics ------------------------------ */

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export interface AnalyticsSeed {
  /** live = served from real data (deliveries/followers); demo = seeded demo metrics */
  mode?: "demo" | "live";
  overview: { impressions: number | null; engagements: number | null; followers: number; clicks: number | null };
  deltas: { impressions: number; engagements: number; followers: number; clicks: number };
  series: { date: string; impressions: number; engagements: number }[];
  byNetwork: {
    provider: ProviderId;
    accountName: string;
    metrics: { impressions: number | null; engagements: number | null; likes: number | null; comments: number | null; shares: number | null; clicks: number | null };
  }[];
  topPosts: TopPost[];
}

export const ANALYTICS_30D: AnalyticsSeed = (() => {
  const rnd = seeded(42);
  const days = 30;
  const series: { date: string; impressions: number; engagements: number }[] = [];
  const base = 5200;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * D);
    const weekday = d.getDay();
    const weekendDip = weekday === 0 || weekday === 6 ? 0.78 : 1;
    const spike = i === 9 ? 2.6 : i === 10 ? 1.8 : 1; // launch spike
    const imp = Math.round(base * weekendDip * spike * (0.85 + rnd() * 0.3));
    const eng = Math.round(imp * (0.052 + rnd() * 0.02));
    series.push({ date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, impressions: imp, engagements: eng });
  }
  const impressions = series.reduce((a, p) => a + p.impressions, 0);
  const engagements = series.reduce((a, p) => a + p.engagements, 0);
  return {
    overview: { impressions, engagements, followers: 538600, clicks: 12400 },
    deltas: { impressions: 18.4, engagements: 9.2, followers: 3.1, clicks: 12.7 },
    series,
    byNetwork: [
      { provider: "instagram", accountName: "ARIA HUB · @myariahub", metrics: { impressions: 412000, engagements: 23400, likes: 19800, comments: 1620, shares: 980, clicks: 3100 } },
      { provider: "tiktok", accountName: "ARIA HUB · @myariahub", metrics: { impressions: 388000, engagements: 41200, likes: 36400, comments: 2210, shares: 1840, clicks: 1750 } },
      { provider: "youtube", accountName: "ARIA HUB", metrics: { impressions: 121000, engagements: 9800, likes: 6400, comments: 820, shares: 610, clicks: 2400 } },
      { provider: "facebook", accountName: "ARIA HUB", metrics: { impressions: 96000, engagements: 5100, likes: 3900, comments: 540, shares: 660, clicks: 1900 } },
      { provider: "linkedin", accountName: "Aria Hub · Company", metrics: { impressions: 68000, engagements: 4200, likes: 3100, comments: 460, shares: 380, clicks: 1600 } },
      { provider: "x", accountName: "ARIA HUB · @ariahub", metrics: { impressions: 44000, engagements: 2100, likes: 1450, comments: 310, shares: 240, clicks: 980 } },
      { provider: "threads", accountName: "ARIA HUB · @myariahub", metrics: { impressions: 22000, engagements: 1800, likes: 1400, comments: 260, shares: 90, clicks: 210 } },
      { provider: "pinterest", accountName: "ARIA HUB", metrics: { impressions: 18000, engagements: 900, likes: null, comments: null, shares: null, clicks: 640 } },
      { provider: "bluesky", accountName: "ARIA HUB · @ariahub.bsky.social", metrics: { impressions: null, engagements: 420, likes: 380, comments: null, shares: null, clicks: null } },
      { provider: "mastodon", accountName: "ARIA HUB · @ariahub@mastodon.social", metrics: { impressions: null, engagements: 210, likes: 180, comments: null, shares: null, clicks: null } },
    ],
    topPosts: [
      { postId: "pst_bts", title: "Behind the scenes reel", caption: "One take, zero notes…", provider: "instagram", publishedAt: ago(3 * D), impressions: 96400, engagements: 12400, hue: 336 },
      { postId: "pst_spotlight", title: "Feature spotlight — compatibility engine", caption: "New in Aria Hub…", provider: "linkedin", publishedAt: ago(1 * D), impressions: 41200, engagements: 5100, hue: 210 },
      { postId: "pst_customer", title: "Customer story — Northwind", caption: "Northwind Agency runs 40+ client channels…", provider: "facebook", publishedAt: ago(13 * D), impressions: 28900, engagements: 3100, hue: 214 },
      { postId: "pst_blog", title: "New blog post — media pipeline", caption: "We wrote about the media pipeline…", provider: "x", publishedAt: ago(1.5 * D), impressions: 18400, engagements: 1200, hue: 342 },
    ],
  };
})();
