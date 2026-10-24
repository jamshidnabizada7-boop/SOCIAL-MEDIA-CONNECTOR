"use client";

import type { MediaAsset, ProviderId, VariantOverride } from "@/lib/types";
import { PROVIDERS } from "@/lib/providers";
import { MediaThumb } from "@/components/ui/media-thumb";
import { Avatar } from "@/components/ui/primitives";
import { ProviderBadge } from "@/components/ui/status";
import { Bookmark, Heart, MessageCircle, MoreHorizontal, Repeat2, Send, ThumbsUp, Volume2, VolumeX } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";

/**
 * Approximate per-network previews. Intentionally evocative rather than
 * pixel-perfect — they communicate caption truncation, media cropping and
 * platform metadata, not clone the proprietary apps.
 */

interface PreviewProps {
  caption: string;
  media: MediaAsset[];
  accountName: string;
  accountHandle: string;
  avatarHue: number;
  variant?: VariantOverride;
}

function MediaRow({ media, ratio, className }: { media: MediaAsset[]; ratio?: string; className?: string }) {
  if (media.length === 0) return null;
  return (
    <div className={cn("flex gap-1 overflow-hidden", className)} style={{ aspectRatio: ratio }}>
      {media.slice(0, 4).map((m) => (
        <MediaThumb key={m.id} asset={m} showKind={false} className="h-full flex-1 rounded-md" />
      ))}
    </div>
  );
}

function InstagramPreview({ caption, media, accountName, accountHandle, avatarHue }: PreviewProps) {
  const truncated = caption.length > 125;
  return (
    <div className="overflow-hidden rounded-xl border bg-surface">
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <span className="rounded-full bg-gradient-to-tr from-[#F58529] via-[#DD2A7B] to-[#8134AF] p-[2px]">
          <span className="block rounded-full bg-surface p-[2px]">
            <Avatar name={accountName} hue={avatarHue} size="sm" />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{accountHandle}</p>
          <p className="text-[11px] text-ink-3">Sponsored · {accountName}</p>
        </div>
        <MoreHorizontal className="size-4 text-ink-3" />
      </div>
      <MediaRow media={media} ratio={media.length > 1 ? "4 / 5" : "1 / 1"} className="border-y" />
      <div className="flex items-center gap-4 px-3.5 py-3 text-ink-2">
        <Heart className="size-5" />
        <MessageCircle className="size-5" />
        <Send className="size-5" />
        <Bookmark className="ml-auto size-5" />
      </div>
      <div className="px-3.5 pb-4">
        <p className="text-[13px] font-semibold">{formatNumber(1240)} likes</p>
        <p className="mt-1 text-[13px] leading-relaxed">
          <span className="font-semibold">{accountHandle}</span>{" "}
          {truncated ? (
            <>
              {caption.slice(0, 125)}… <span className="text-ink-3">more</span>
            </>
          ) : (
            caption
          )}
        </p>
      </div>
    </div>
  );
}

function FacebookPreview({ caption, media, accountName, avatarHue }: PreviewProps) {
  return (
    <div className="overflow-hidden rounded-xl border bg-surface">
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <Avatar name={accountName} hue={avatarHue} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{accountName}</p>
          <p className="text-[11px] text-ink-3">Just now · 🌐</p>
        </div>
        <MoreHorizontal className="size-4 text-ink-3" />
      </div>
      <p className="whitespace-pre-wrap px-3.5 pb-3 text-[13px] leading-relaxed">{caption}</p>
      <MediaRow media={media} ratio="16 / 9" className="border-y" />
      <div className="flex items-center justify-between px-3.5 py-2 text-[12px] text-ink-3">
        <span className="inline-flex items-center gap-1"><ThumbsUp className="size-3.5" /> Like · Comment · Share</span>
      </div>
    </div>
  );
}

function LinkedInPreview({ caption, media, accountName, avatarHue }: PreviewProps) {
  return (
    <div className="overflow-hidden rounded-xl border bg-surface">
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <Avatar name={accountName} hue={avatarHue} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{accountName}</p>
          <p className="text-[11px] text-ink-3">2,847 followers · 2h</p>
        </div>
      </div>
      <p className="whitespace-pre-wrap px-3.5 pb-3 text-[13px] leading-relaxed">
        {caption.length > 210 ? (
          <>
            {caption.slice(0, 210)}… <span className="font-medium text-info-ink">see more</span>
          </>
        ) : (
          caption
        )}
      </p>
      <MediaRow media={media} ratio="16 / 9" className="border-y" />
      <div className="flex items-center justify-between px-3.5 py-2.5 text-[12px] font-medium text-ink-2">
        <span className="inline-flex items-center gap-1.5"><ThumbsUp className="size-3.5 text-info" /> Like</span>
        <span className="inline-flex items-center gap-1.5"><MessageCircle className="size-3.5" /> Comment</span>
        <span className="inline-flex items-center gap-1.5"><Repeat2 className="size-3.5" /> Repost</span>
        <span className="inline-flex items-gap-1.5"><Send className="size-3.5" /> Send</span>
      </div>
    </div>
  );
}

function XPreview({ caption, accountName, accountHandle, avatarHue, media }: PreviewProps) {
  return (
    <div className="rounded-xl border bg-surface p-3.5">
      <div className="flex gap-2.5">
        <Avatar name={accountName} hue={avatarHue} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px]">
            <span className="truncate font-bold">{accountName}</span>
            <span className="truncate text-ink-3">{accountHandle} · 0s</span>
            <MoreHorizontal className="ml-auto size-4 text-ink-3" />
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed">{caption}</p>
          <MediaRow media={media} ratio="16 / 9" className="mt-2.5 rounded-xl border" />
          <div className="mt-2.5 flex items-center justify-between pr-6 text-ink-3">
            <span className="inline-flex items-center gap-1.5 text-[12px]"><MessageCircle className="size-4" /> 12</span>
            <span className="inline-flex items-center gap-1.5 text-[12px]"><Repeat2 className="size-4" /> 5</span>
            <span className="inline-flex items-center gap-1.5 text-[12px]"><Heart className="size-4" /> 48</span>
            <span className="text-[12px]"><Send className="size-4" /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TikTokPreview({ caption, media, accountHandle, variant }: PreviewProps) {
  const privacy = variant?.settings.privacyOption;
  return (
    <div className="relative mx-auto w-full max-w-[240px] overflow-hidden rounded-xl border bg-ink" style={{ aspectRatio: "9 / 16" }}>
      {media[0] ? (
        <MediaThumb asset={media[0]} showKind={false} className="absolute inset-0 size-full rounded-none border-0" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-white/50 text-xs">9:16 video</div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 pb-4">
        <p className="text-[13px] font-bold text-white">{accountHandle}</p>
        <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-white/90">{caption}</p>
        <p className="mt-2 text-[11px] text-white/70">
          ♬ original sound — {accountHandle.replace("@", "")}
        </p>
        <p className="mt-1.5 inline-flex rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {privacy === "followers" ? "Followers can view" : privacy === "private" ? "Only me" : privacy === "public" ? "Everyone can view" : "Privacy not set"}
        </p>
      </div>
      <div className="absolute bottom-20 right-2 flex flex-col items-center gap-3 text-white">
        <span className="flex flex-col items-center"><Heart className="size-5" /><span className="text-[10px]">1.2K</span></span>
        <span className="flex flex-col items-center"><MessageCircle className="size-5" /><span className="text-[10px]">84</span></span>
        <span className="flex flex-col items-center"><Send className="size-5" /><span className="text-[10px]">Share</span></span>
      </div>
    </div>
  );
}

function YouTubePreview({ caption, media, accountName, variant }: PreviewProps) {
  const title = variant?.title || "(title not set)";
  return (
    <div className="rounded-xl border bg-surface p-3">
      <div className="relative">
        <MediaRow media={media} ratio="16 / 9" className="rounded-lg border" />
        {media[0]?.durationSec !== undefined && (
          <span className="tnum absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {Math.floor(media[0].durationSec / 60)}:{String(media[0].durationSec % 60).padStart(2, "0")}
          </span>
        )}
      </div>
      <div className="mt-3 flex gap-2.5">
        <Avatar name={accountName} hue={162} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[13.5px] font-semibold leading-snug">{title}</p>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {accountName} · 0 views · just now
          </p>
          <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-[12px] leading-snug text-ink-2">{caption || "(description)"}</p>
          <p className="mt-1 text-[11px] text-ink-3">
            {variant?.settings.visibility === "unlisted" ? "Unlisted" : variant?.settings.visibility === "private" ? "Private" : "Public"}
            {variant?.settings.madeForKids === true ? " · Made for kids" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

function ThreadsPreview({ caption, media, accountHandle, avatarHue }: PreviewProps) {
  return (
    <div className="rounded-xl border bg-surface p-3.5">
      <div className="flex gap-2.5">
        <Avatar name={accountHandle} hue={avatarHue} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">{accountHandle}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-relaxed">{caption}</p>
          <MediaRow media={media} ratio="4 / 5" className="mt-2 max-w-[240px] rounded-lg border" />
        </div>
      </div>
    </div>
  );
}

function PinterestPreview({ caption, media, accountName, variant }: PreviewProps) {
  const board = variant?.settings.boardId;
  return (
    <div className="mx-auto w-full max-w-[240px]">
      <div className="overflow-hidden rounded-2xl border bg-surface">
        <MediaRow media={media} ratio="2 / 3" />
        <div className="p-3">
          <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{caption || "(Pin description)"}</p>
          <p className="mt-1.5 text-[11px] text-ink-3">
            {board ? "Saved to the selected board" : "No board selected"}
          </p>
        </div>
      </div>
    </div>
  );
}

function BlueskyPreview({ caption, accountName, accountHandle, avatarHue, media }: PreviewProps) {
  return (
    <div className="rounded-xl border bg-surface p-3.5">
      <div className="flex gap-2.5">
        <Avatar name={accountName} hue={avatarHue} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px]">
            <span className="font-bold">{accountName}</span>{" "}
            <span className="text-ink-3">{accountHandle}</span>
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-relaxed">{caption}</p>
          <MediaRow media={media} ratio="16 / 9" className="mt-2 rounded-lg border" />
          <p className="mt-2 text-[11px] text-ink-3">via Aria Hub</p>
        </div>
      </div>
    </div>
  );
}

function MastodonPreview({ caption, accountHandle, media, variant }: PreviewProps) {
  return (
    <div className="rounded-xl border bg-surface p-3.5">
      <div className="flex gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-[#6364FF] text-white">
          <ProviderBadge provider="mastodon" size="xs" className="bg-transparent" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px]">
            <span className="font-bold">ARIA HUB</span>{" "}
            <span className="text-ink-3">{accountHandle}</span>
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-relaxed">{caption}</p>
          <MediaRow media={media} ratio="16 / 9" className="mt-2 rounded-lg border" />
          <p className="mt-2 text-[11px] text-ink-3">
            {variant?.settings.privacyOption === "private" ? "Followers-only" : "Public"} · mastodon.social
          </p>
        </div>
      </div>
    </div>
  );
}

export function NetworkPreview({ provider, ...props }: PreviewProps & { provider: ProviderId }) {
  switch (provider) {
    case "instagram":
      return <InstagramPreview {...props} />;
    case "facebook":
      return <FacebookPreview {...props} />;
    case "linkedin":
      return <LinkedInPreview {...props} />;
    case "x":
      return <XPreview {...props} />;
    case "tiktok":
      return <TikTokPreview {...props} />;
    case "youtube":
      return <YouTubePreview {...props} />;
    case "threads":
      return <ThreadsPreview {...props} />;
    case "pinterest":
      return <PinterestPreview {...props} />;
    case "bluesky":
      return <BlueskyPreview {...props} />;
    case "mastodon":
      return <MastodonPreview {...props} />;
  }
}

export function PreviewShell({ provider, children, customized }: { provider: ProviderId; children: React.ReactNode; customized?: boolean }) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <ProviderBadge provider={provider} size="sm" />
        <span className="text-[13px] font-semibold">{PROVIDERS[provider].name}</span>
        {customized && (
          <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn-ink">Customized</span>
        )}
        <span className="ml-auto text-[11px] text-ink-3">approximate preview</span>
      </div>
      {children}
    </div>
  );
}

export function VideoMuteHint() {
  return (
    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
      <VolumeX className="size-3" /> Autoplay usually starts muted
    </p>
  );
}

export const Volume2Icon = Volume2;
