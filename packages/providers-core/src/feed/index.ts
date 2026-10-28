import type {
  FeedCapability,
  FeedSourceConfig,
  FeedSourceKind,
  ProviderId,
  UniversalFeedItem,
} from "@aria/shared-types";
import { isOfficialFeedEmbed } from "@aria/shared-types";
import { graphBase } from "../config.js";
import { fetchJson, type FetchLike } from "../http.js";
import { assertPublicHost } from "../net-guard.js";
import { plainHtml } from "../engagement/util.js";
import { canonicalFeedUrl, safeFeedUrl } from "./urls.js";
export { canonicalFeedUrl, safeFeedUrl } from "./urls.js";

export interface FeedContext {
  provider: ProviderId;
  kind: FeedSourceKind;
  config: FeedSourceConfig;
  account?: {
    externalAccountId: string;
    displayName: string;
    handle: string;
    instanceUrl?: string;
    scopes: string[];
  };
  accessToken?: string;
  fetchImpl?: FetchLike;
}
export type RetrievedFeedItem = Omit<
  UniversalFeedItem,
  "id" | "sourceId" | "sourceType" | "topics"
>;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const array = (v: unknown) => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown, max = 10000) =>
  typeof v === "string" ? v.slice(0, max) : "";
const metric = (v: unknown) =>
  (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) &&
  Number.isFinite(Number(v)) &&
  Number(v) >= 0
    ? Number(v)
    : null;
const date = (v: unknown) => {
  const d = new Date(str(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const id = (v: string) => encodeURIComponent(v);
const publicBsky = () =>
  process.env.NODE_ENV !== "production" && process.env.ARIA_FEED_BLUESKY_ORIGIN
    ? process.env.ARIA_FEED_BLUESKY_ORIGIN.replace(/\/$/, "")
    : "https://public.api.bsky.app";
const yKey = () => process.env.YOUTUBE_DATA_API_KEY;

export function feedCapabilities(): FeedCapability[] {
  return (
    [
      [
        "bluesky",
        ["public", "creator", "search", "account", "timeline", "url"],
        "Public feed generators, author feeds and search; authorized following timeline.",
        "Official Bluesky post player.",
        "Public AppView needs no account. Following timelines require the connected account's authorization.",
        true,
      ],
      [
        "mastodon",
        ["public", "creator", "search", "account", "timeline", "url"],
        "Public statuses only; instance rules and authorization apply.",
        "Native link and permitted public images; open video on the instance.",
        "Many instances require a connected account with read:statuses. Home timelines additionally need read:statuses.",
        true,
      ],
      [
        "youtube",
        ["public", "creator", "search", "account", "url"],
        "Data API search, selected channels and embeddable public videos.",
        "Official YouTube privacy-enhanced player. Short duration is not a Shorts classification.",
        "Discovery requires YOUTUBE_DATA_API_KEY. Public URL metadata uses official oEmbed; account reads require YouTube authorization.",
        !!yKey(),
      ],
      [
        "tiktok",
        ["account", "url"],
        "Authorized creator videos through Display API; approved public video URLs.",
        "Official TikTok Embed Player.",
        "Display API requires approved Login Kit/Display API and video.list. No native For You access. Publishing remains disabled.",
        false,
      ],
      [
        "instagram",
        ["account", "url"],
        "Connected professional-account media. Other URLs are link references only.",
        "Native link/image preview; arbitrary embeds are not enabled.",
        "instagram_basic and relevant Meta review. Hashtag/business discovery is not enabled without its reviewed access.",
        false,
      ],
      [
        "facebook",
        ["account", "url"],
        "Authorized Page posts only; other URLs are link references.",
        "Open on Facebook; no arbitrary iframe markup.",
        "pages_read_engagement and Page/app access.",
        false,
      ],
      [
        "threads",
        ["account", "url"],
        "Authorized profile posts; other URLs are link references.",
        "Open on Threads.",
        "threads_basic and an authorized Threads profile.",
        false,
      ],
      [
        "x",
        ["url"],
        "Validated public link references. Timeline API is not enabled.",
        "Open on X.",
        "Timeline retrieval needs approved API access and an explicitly configured budget.",
        false,
      ],
      [
        "linkedin",
        ["url"],
        "Validated public link references; no general home feed API.",
        "Open on LinkedIn.",
        "Organization/member retrieval requires the applicable reviewed product; not enabled here.",
        false,
      ],
      [
        "pinterest",
        ["url"],
        "Validated public Pin references. General discovery is not enabled.",
        "Open on Pinterest.",
        "Reviewed access and verified public board visibility are required for future API sources.",
        false,
      ],
    ] as Array<[ProviderId, FeedSourceKind[], string, string, string, boolean]>
  ).map(([provider, kinds, discovery, embeds, requirements, configured]) => ({
    provider,
    kinds,
    discovery,
    embeds,
    requirements,
    configured,
  }));
}

export function validateFeedSource(
  provider: ProviderId,
  kind: FeedSourceKind,
  config: FeedSourceConfig,
): FeedSourceConfig {
  if (
    !feedCapabilities()
      .find((c) => c.provider === provider)
      ?.kinds.includes(kind)
  )
    throw new Error("This source type is not supported for this platform.");
  const result: FeedSourceConfig = {};
  if (kind === "url") {
    result.url = canonicalFeedUrl(provider, config.url || "");
    return result;
  }
  if (config.query) result.query = config.query.trim().slice(0, 120);
  if (config.actor) result.actor = config.actor.trim().slice(0, 300);
  if (provider === "bluesky") {
    if (kind === "public") {
      result.feed =
        config.feed ||
        "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot";
      if (
        !/^at:\/\/did:[a-z]+:[a-zA-Z0-9.:%-]+\/app\.bsky\.feed\.generator\/[\w.-]+$/.test(
          result.feed,
        )
      )
        throw new Error("Use a public AT Protocol feed-generator URI.");
    }
    if (
      kind === "creator" &&
      (!result.actor ||
        !/^(?:did:[a-z]+:[\w.:%-]+|[\w.-]+\.[a-zA-Z]{2,})$/.test(result.actor))
    )
      throw new Error("Enter a Bluesky handle or DID.");
  }
  if (provider === "mastodon") {
    const u = new URL(config.instance || "https://mastodon.social");
    if (!safeFeedUrl(u.href) || u.pathname !== "/" || u.search || u.hash)
      throw new Error("Use the HTTPS origin of a public Mastodon instance.");
    result.instance = u.origin;
    if (kind === "creator" && !/^\d{1,30}$/.test(result.actor || ""))
      throw new Error(
        "Enter the creator's numeric account ID on this instance.",
      );
    if (kind === "search" && !/^[\p{L}\p{N}_]{1,80}$/u.test(result.query || ""))
      throw new Error("Mastodon topic sources use one hashtag without #.");
  }
  if (
    kind === "creator" &&
    provider === "youtube" &&
    !/^UC[\w-]{22}$/.test(result.actor || "")
  )
    throw new Error("Enter a YouTube channel ID beginning with UC.");
  if (kind === "search" && !result.query)
    throw new Error("Enter a search term or topic.");
  return result;
}

async function read(
  ctx: FeedContext,
  url: string,
  authorized = false,
  init: RequestInit = {},
): Promise<Obj> {
  // Explicit local harness only. Production always uses official API destinations.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.ARIA_ALLOW_PRIVATE_INSTANCES === "true" &&
    process.env.ARIA_FEED_FIXTURE_ORIGIN &&
    !ctx.fetchImpl
  ) {
    const target = new URL(url);
    url = new URL(
      `/feed-fixture/${ctx.provider}${target.pathname}${target.search}`,
      process.env.ARIA_FEED_FIXTURE_ORIGIN,
    ).href;
  }
  await assertPublicHost(url);
  const data = await fetchJson<unknown>(ctx.provider, url, {
    ...init,
    redirect: "error",
    timeoutMs: 15000,
    maxResponseBytes: 2000000,
    fetchImpl: ctx.fetchImpl,
    headers: {
      Accept: "application/json",
      ...(authorized && ctx.accessToken
        ? { Authorization: `Bearer ${ctx.accessToken}` }
        : {}),
      ...init.headers,
    },
  });
  return Array.isArray(data) ? { data } : obj(data);
}
function base(
  ctx: FeedContext,
  postId: string,
  originalUrl: unknown,
  name: string,
  authorId: string,
): RetrievedFeedItem | null {
  const url = safeFeedUrl(originalUrl);
  if (!url || !postId || !authorId) return null;
  return {
    provider: ctx.provider,
    providerPostId: postId,
    authorId,
    authorName: name || "Creator",
    contentType: "text",
    caption: "",
    images: [],
    originalUrl: url,
    publishedAt: null,
    likeCount: null,
    commentCount: null,
    shareCount: null,
    canEmbed: false,
    availability: "available",
    sensitive: false,
  };
}
function bskyItem(ctx: FeedContext, p: Obj): RetrievedFeedItem | null {
  const author = obj(p.author),
    record = obj(p.record),
    uri = str(p.uri),
    embed = obj(p.embed);
  const labels = [
    ...array(p.labels),
    ...array(author.labels),
    ...array(obj(record.labels).values),
  ]
    .filter(
      (label) =>
        label.neg !== true &&
        (!Number.isFinite(Date.parse(str(label.exp))) ||
          Date.parse(str(label.exp)) > Date.now()),
    )
    .map((label) => str(label.val));
  // Global moderation restrictions are not a user's "show sensitive" override.
  // These public display/embedding paths have no age or native-auth gate.
  if (
    labels.some((label) =>
      [
        "!hide",
        "!warn",
        "!no-unauthenticated",
        "porn",
        "sexual",
        "graphic-media",
        "gore",
      ].includes(label),
    )
  )
    return null;
  const item = base(
    ctx,
    uri,
    `https://bsky.app/profile/${id(str(author.did))}/post/${id(uri.split("/").at(-1) || "")}`,
    str(author.displayName) || str(author.handle),
    str(author.did),
  );
  if (!item || !/^at:\/\/did:/.test(uri) || p.notFound || p.blocked)
    return null;
  if (labels.includes("nudity")) item.sensitive = true;
  item.caption = str(record.text);
  item.authorHandle = str(author.handle);
  item.authorAvatarUrl = safeFeedUrl(author.avatar);
  item.publishedAt = date(record.createdAt);
  item.likeCount = metric(p.likeCount);
  item.commentCount = metric(p.replyCount);
  item.shareCount = metric(p.repostCount);
  const media = obj(embed.media),
    images = array(embed.images).length
      ? array(embed.images)
      : array(media.images);
  item.images = images
    .map((i) => ({
      url: safeFeedUrl(i.fullsize) || safeFeedUrl(i.thumb) || "",
      alt: str(i.alt, 1000),
    }))
    .filter((i) => i.url)
    .slice(0, 8);
  item.contentType =
    item.images.length > 1 ? "carousel" : item.images.length ? "image" : "text";
  if (str(embed.$type).includes("video") || str(media.$type).includes("video"))
    item.contentType = "video";
  item.thumbnailUrl =
    safeFeedUrl(embed.thumbnail) ||
    safeFeedUrl(media.thumbnail) ||
    item.images[0]?.url;
  item.embedUrl = `https://embed.bsky.app/embed/${uri.slice("at://".length)}`;
  item.canEmbed = isOfficialFeedEmbed("bluesky", item.embedUrl);
  return item;
}
function mastodonItem(ctx: FeedContext, s: Obj): RetrievedFeedItem | null {
  if (s.visibility !== "public" || s.reblog || s.deleted || s.in_reply_to_id)
    return null;
  const a = obj(s.account),
    origin = new URL(
      ctx.config.instance ||
        ctx.account?.instanceUrl ||
        "https://mastodon.social",
    ).origin;
  const item = base(
    ctx,
    `${origin}:${str(s.id)}`,
    s.url,
    str(a.display_name) || str(a.username),
    `${origin}:${str(a.id)}`,
  );
  if (!item) return null;
  item.caption = plainHtml(s.content);
  item.authorHandle = str(a.acct);
  item.authorAvatarUrl = safeFeedUrl(a.avatar_static);
  item.publishedAt = date(s.created_at);
  item.sensitive = s.sensitive === true || !!str(s.spoiler_text);
  item.likeCount = metric(s.favourites_count);
  item.commentCount = metric(s.replies_count);
  item.shareCount = metric(s.reblogs_count);
  const media = array(s.media_attachments);
  item.thumbnailUrl = safeFeedUrl(media[0]?.preview_url);
  item.images = media
    .filter((m) => m.type === "image")
    .map((m) => ({
      url: safeFeedUrl(m.url) || "",
      alt: str(m.description, 1000),
    }))
    .filter((m) => m.url)
    .slice(0, 8);
  item.contentType = media.some((m) =>
    ["video", "gifv", "audio"].includes(str(m.type)),
  )
    ? "video"
    : item.images.length > 1
      ? "carousel"
      : item.images.length
        ? "image"
        : "text";
  return item;
}
async function youtube(ctx: FeedContext): Promise<RetrievedFeedItem[]> {
  if (!yKey() && !ctx.accessToken)
    throw new Error(
      "YouTube discovery needs a configured Data API key or authorized account. You can add a public video URL instead.",
    );
  const auth = !!ctx.accessToken,
    query = new URLSearchParams({
      part: "snippet",
      type: "video",
      maxResults: "25",
      videoEmbeddable: "true",
      order: "date",
      ...(yKey() && !auth ? { key: yKey()! } : {}),
    });
  if (ctx.kind === "creator" || ctx.kind === "account")
    query.set(
      "channelId",
      ctx.account?.externalAccountId || ctx.config.actor || "",
    );
  else query.set("q", ctx.config.query || "education technology");
  const search = await read(
    ctx,
    `https://www.googleapis.com/youtube/v3/search?${query}`,
    auth,
  );
  const ids = array(search.items)
    .map((i) => str(obj(i.id).videoId))
    .filter((i) => /^[\w-]{11}$/.test(i));
  if (!ids.length) return [];
  const details = new URLSearchParams({
    part: "snippet,status,statistics,contentDetails",
    id: ids.join(","),
    ...(yKey() && !auth ? { key: yKey()! } : {}),
  });
  const result = await read(
    ctx,
    `https://www.googleapis.com/youtube/v3/videos?${details}`,
    auth,
  );
  return array(result.items).flatMap((v) => {
    const status = obj(v.status),
      s = obj(v.snippet),
      stats = obj(v.statistics);
    if (
      status.privacyStatus !== "public" ||
      status.embeddable !== true ||
      s.liveBroadcastContent === "upcoming"
    )
      return [];
    const item = base(
      ctx,
      str(v.id),
      `https://www.youtube.com/watch?v=${str(v.id)}`,
      str(s.channelTitle),
      str(s.channelId),
    );
    if (!item) return [];
    item.caption = `${str(s.title)}\n${str(s.description, 2000)}`;
    item.publishedAt = date(s.publishedAt);
    item.contentType = "video";
    item.thumbnailUrl = safeFeedUrl(obj(obj(s.thumbnails).high).url);
    item.embedUrl = `https://www.youtube-nocookie.com/embed/${str(v.id)}`;
    item.canEmbed = isOfficialFeedEmbed(ctx.provider, item.embedUrl);
    item.likeCount = metric(stats.likeCount);
    item.commentCount = metric(stats.commentCount);
    return [item];
  });
}
async function reference(ctx: FeedContext): Promise<RetrievedFeedItem[]> {
  const url = canonicalFeedUrl(ctx.provider, ctx.config.url || "");
  if (ctx.provider === "bluesky") {
    const parts = new URL(url).pathname.split("/");
    const uri = `at://${decodeURIComponent(parts[2])}/app.bsky.feed.post/${parts[4]}`;
    const data = await read(
      ctx,
      `${publicBsky()}/xrpc/app.bsky.feed.getPostThread?uri=${id(uri)}&depth=0`,
    );
    const item = bskyItem(ctx, obj(obj(data.thread).post));
    return item ? [item] : [];
  }
  if (ctx.provider === "mastodon") {
    const u = new URL(url),
      statusId = u.pathname.split("/").filter(Boolean).at(-1)!;
    const data = await read(ctx, `${u.origin}/api/v1/statuses/${id(statusId)}`);
    const item = mastodonItem(
      { ...ctx, config: { ...ctx.config, instance: u.origin } },
      data,
    );
    return item ? [item] : [];
  }
  if (["youtube", "tiktok"].includes(ctx.provider)) {
    const endpoint =
      ctx.provider === "youtube"
        ? "https://www.youtube.com/oembed"
        : "https://www.tiktok.com/oembed";
    const data = await read(ctx, `${endpoint}?url=${id(url)}&format=json`);
    const author = safeFeedUrl(data.author_url),
      postId =
        ctx.provider === "youtube"
          ? new URL(url).searchParams.get("v")!
          : url.split("/").filter(Boolean).at(-1)!;
    const item = base(
      ctx,
      postId,
      url,
      str(data.author_name),
      author || str(data.author_name),
    );
    if (!item) return [];
    item.caption = str(data.title);
    item.contentType = "video";
    item.thumbnailUrl = safeFeedUrl(data.thumbnail_url);
    item.embedUrl =
      ctx.provider === "youtube"
        ? `https://www.youtube-nocookie.com/embed/${postId}`
        : `https://www.tiktok.com/player/v1/${postId}`;
    item.canEmbed = isOfficialFeedEmbed(ctx.provider, item.embedUrl);
    return [item];
  }
  const item = base(ctx, url, url, `On ${ctx.provider}`, url);
  if (!item) return [];
  item.contentType = "link";
  item.availability = "preview_only";
  return [item];
}

/** Read-only adapters. No video bytes, private HTML, publishing or paid X calls. */
export async function retrieveFeed(
  ctx: FeedContext,
): Promise<RetrievedFeedItem[]> {
  if (ctx.kind === "url") return reference(ctx);
  if (ctx.provider === "bluesky") {
    if (ctx.kind === "timeline") {
      if (!ctx.account || !ctx.accessToken)
        throw new Error(
          "Connect a Bluesky account to read its following timeline.",
        );
      const origin = new URL(ctx.account.instanceUrl || "https://bsky.social")
        .origin;
      const data = await read(
        ctx,
        `${origin}/xrpc/app.bsky.feed.getTimeline?limit=50`,
        true,
        { headers: { "atproto-proxy": "did:web:api.bsky.app#bsky_appview" } },
      );
      return array(data.feed)
        .map((f) => bskyItem(ctx, obj(f.post)))
        .filter((p): p is RetrievedFeedItem => !!p);
    }
    const params = new URLSearchParams({ limit: "50" });
    let method: string;
    if (ctx.kind === "creator" || ctx.kind === "account") {
      method = "getAuthorFeed";
      params.set("actor", ctx.account?.externalAccountId || ctx.config.actor!);
      params.set("filter", "posts_no_replies");
    } else if (ctx.kind === "search") {
      method = "searchPosts";
      params.set("q", ctx.config.query!);
      params.set("sort", "latest");
    } else {
      method = "getFeed";
      params.set("feed", ctx.config.feed!);
    }
    const data = await read(
      ctx,
      `${publicBsky()}/xrpc/app.bsky.feed.${method}?${params}`,
    );
    return (
      ctx.kind === "search"
        ? array(data.posts)
        : array(data.feed).map((f) => obj(f.post))
    )
      .map((p) => bskyItem(ctx, p))
      .filter((p): p is RetrievedFeedItem => !!p);
  }
  if (ctx.provider === "mastodon") {
    const origin = new URL(
      ctx.config.instance ||
        ctx.account?.instanceUrl ||
        "https://mastodon.social",
    ).origin;
    if (
      ctx.accessToken &&
      ctx.account?.instanceUrl &&
      new URL(ctx.account.instanceUrl).origin !== origin
    )
      throw new Error(
        "Account credentials cannot be sent to another instance.",
      );
    const route =
      ctx.kind === "creator" || ctx.kind === "account"
        ? `/api/v1/accounts/${id(ctx.account?.externalAccountId || ctx.config.actor!)}/statuses?exclude_replies=true&exclude_reblogs=true&limit=40`
        : ctx.kind === "search"
          ? `/api/v1/timelines/tag/${id(ctx.config.query!)}?limit=40`
          : ctx.kind === "timeline"
            ? "/api/v1/timelines/home?limit=40"
            : "/api/v1/timelines/public?local=true&limit=40";
    const data = await read(ctx, origin + route, !!ctx.accessToken);
    return array(data.data)
      .map((p) => mastodonItem(ctx, p))
      .filter((p): p is RetrievedFeedItem => !!p);
  }
  if (ctx.provider === "youtube") return youtube(ctx);
  if (!ctx.account || !ctx.accessToken)
    throw new Error("Connect an authorized account for this source.");
  if (ctx.provider === "tiktok") {
    if (!ctx.account.scopes.includes("video.list"))
      throw new Error(
        "TikTok Display API requires video.list and approved Login Kit/Display API.",
      );
    const data = await read(
      ctx,
      "https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,cover_image_url,share_url,like_count,comment_count,share_count",
      true,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_count: 20 }),
      },
    );
    if (obj(data.error).code && obj(data.error).code !== "ok")
      throw new Error("TikTok could not authorize this creator's videos.");
    return array(obj(data.data).videos).flatMap((v) => {
      const item = base(
        ctx,
        str(v.id),
        v.share_url,
        ctx.account!.displayName,
        ctx.account!.externalAccountId,
      );
      if (!item) return [];
      item.authorHandle = ctx.account!.handle;
      item.caption = str(v.title);
      item.contentType = "video";
      item.publishedAt =
        metric(v.create_time)! > 0
          ? new Date(Number(v.create_time) * 1000).toISOString()
          : null;
      item.thumbnailUrl = safeFeedUrl(v.cover_image_url);
      item.embedUrl = `https://www.tiktok.com/player/v1/${str(v.id)}`;
      item.canEmbed = isOfficialFeedEmbed("tiktok", item.embedUrl);
      item.likeCount = metric(v.like_count);
      item.commentCount = metric(v.comment_count);
      item.shareCount = metric(v.share_count);
      return [item];
    });
  }
  if (!["facebook", "instagram", "threads"].includes(ctx.provider))
    throw new Error(
      "This provider does not have an enabled feed API integration.",
    );
  const isFB = ctx.provider === "facebook",
    isIG = ctx.provider === "instagram";
  const baseUrl =
    ctx.provider === "threads" ? "https://graph.threads.net/v1.0" : graphBase();
  const fields = isFB
    ? "id,message,created_time,permalink_url,full_picture"
    : isIG
      ? "id,caption,media_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count"
      : "id,text,media_type,permalink,thumbnail_url,media_url,timestamp,username";
  const data = await read(
    ctx,
    `${baseUrl}/${id(ctx.account.externalAccountId)}/${isFB ? "published_posts" : isIG ? "media" : "threads"}?fields=${fields}&limit=30`,
    true,
  );
  return array(data.data).flatMap((p) => {
    const item = base(
      ctx,
      str(p.id),
      isFB ? p.permalink_url : p.permalink,
      ctx.account!.displayName,
      ctx.account!.externalAccountId,
    );
    if (!item) return [];
    item.authorHandle = ctx.account!.handle;
    item.caption = str(isFB ? p.message : isIG ? p.caption : p.text);
    item.publishedAt = date(
      isFB ? p.created_time : isIG ? p.timestamp : p.timestamp,
    );
    const type = str(p.media_type);
    item.contentType =
      type === "VIDEO"
        ? "video"
        : type.includes("CAROUSEL")
          ? "carousel"
          : ["IMAGE", "CAROUSEL_ALBUM"].includes(type)
            ? "image"
            : isFB && p.full_picture
              ? "link"
              : "text";
    item.thumbnailUrl =
      safeFeedUrl(p.thumbnail_url) ||
      safeFeedUrl(p.full_picture) ||
      (item.contentType === "image" ? safeFeedUrl(p.media_url) : undefined);
    if (item.contentType === "image" && item.thumbnailUrl)
      item.images = [{ url: item.thumbnailUrl }];
    item.likeCount = metric(p.like_count);
    item.commentCount = metric(p.comments_count);
    return [item];
  });
}
