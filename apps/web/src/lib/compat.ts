import type { MediaAsset, ProviderId, SocialAccount, VariantOverride } from "./types";
import { PROVIDERS } from "./providers";

/**
 * Compatibility engine.
 *
 * Runs entirely on locally-known data (the capability registry + media
 * inspection metadata) so that nothing is "discovered at the API" that could
 * have been caught in the composer. Each issue carries an optional safe fix;
 * fixes create derived media or platform variants — they never modify the
 * user's original upload or universal caption.
 */

export type CompatFix =
  | { kind: "trim_caption"; label: string; targetLength: number; provider: ProviderId }
  | { kind: "crop_media"; label: string; mediaId: string; aspect: string; provider: ProviderId }
  | { kind: "compress_media"; label: string; mediaId: string; provider: ProviderId }
  | { kind: "trim_video"; label: string; mediaId: string; toSec: number; provider: ProviderId }
  | {
      kind: "open_variant";
      label: string;
      provider: ProviderId;
      field: "title" | "board" | "privacy" | "visibility";
    }
  | { kind: "reconnect"; label: string; accountId: string };

export interface CompatIssue {
  id: string;
  provider: ProviderId;
  accountId?: string;
  severity: "error" | "warning" | "tip";
  title: string;
  message: string;
  fix?: CompatFix;
}

export interface CompatInput {
  caption: string;
  mediaIds: string[];
  variants: VariantOverride[];
  accountIds: string[];
  accounts: SocialAccount[];
  media: MediaAsset[];
}

function effectiveCaption(input: CompatInput, provider: ProviderId): string {
  const v = input.variants.find((x) => x.provider === provider);
  return v?.caption ?? input.caption;
}

function variant(input: CompatInput, provider: ProviderId): VariantOverride | undefined {
  return input.variants.find((x) => x.provider === provider);
}

export function evaluateCompatibility(input: CompatInput): CompatIssue[] {
  const issues: CompatIssue[] = [];
  const media = input.mediaIds
    .map((id) => input.media.find((m) => m.id === id))
    .filter((m): m is MediaAsset => !!m);
  const images = media.filter((m) => m.kind === "image");
  const videos = media.filter((m) => m.kind === "video");
  let n = 0;
  const add = (i: Omit<CompatIssue, "id">) => issues.push({ ...i, id: `issue_${n++}` });

  for (const accountId of input.accountIds) {
    const account = input.accounts.find((a) => a.id === accountId);
    if (!account) continue;
    const caps = PROVIDERS[account.provider].capabilities;
    const pn = PROVIDERS[account.provider].name;

    // Connection health gates everything.
    if (account.connection === "needs_reauth" || account.connection === "disconnected") {
      add({
        provider: account.provider,
        accountId: account.id,
        severity: "error",
        title: `${pn} needs to be reconnected`,
        message: account.connectionNote ?? "This account's access was revoked. Reconnect before publishing.",
        fix: { kind: "reconnect", label: "Reconnect account", accountId: account.id },
      });
    } else if (account.connection === "token_expiring") {
      add({
        provider: account.provider,
        accountId: account.id,
        severity: "tip",
        title: `${pn} token expires soon`,
        message: "It will refresh automatically. If refresh fails, scheduled content pauses safely.",
      });
    }

    // Media presence rules.
    if (media.length === 0) {
      if (account.provider === "instagram" || account.provider === "pinterest") {
        add({
          provider: account.provider,
          accountId: account.id,
          severity: "error",
          title: `${pn} requires an image or video`,
          message: `Posts to ${pn} must include media.`,
        });
      }
      if (account.provider === "youtube" || account.provider === "tiktok") {
        add({
          provider: account.provider,
          accountId: account.id,
          severity: "error",
          title: `${pn} requires a video for this post`,
          message: `Only video posts are supported on ${pn}.`,
        });
      }
    } else {
      if ((account.provider === "youtube" || account.provider === "tiktok") && videos.length === 0) {
        add({
          provider: account.provider,
          accountId: account.id,
          severity: "error",
          title: `${pn} requires a video for this post`,
          message: `This post contains ${images.length > 0 ? "images" : "text"} only. Add a video, or deselect ${pn}.`,
        });
      }

      // Video limits.
      for (const v of videos) {
        if (caps.maxVideoDurationSec > 0 && v.durationSec && v.durationSec > caps.maxVideoDurationSec) {
          add({
            provider: account.provider,
            accountId: account.id,
            severity: "error",
            title: `Video is too long for ${pn}`,
            message: `“${v.filename}” runs ${Math.floor(v.durationSec / 60)}:${String(v.durationSec % 60).padStart(2, "0")} — ${pn} accepts up to ${Math.floor(caps.maxVideoDurationSec / 60)} minutes.`,
            fix: {
              kind: "trim_video",
              label: "Trim a copy for this network",
              mediaId: v.id,
              toSec: caps.maxVideoDurationSec,
              provider: account.provider,
            },
          });
        }
        if (caps.maxVideoBytes > 0 && v.bytes > caps.maxVideoBytes) {
          add({
            provider: account.provider,
            accountId: account.id,
            severity: "error",
            title: `Video file is too large for ${pn}`,
            message: `“${v.filename}” exceeds ${pn}'s ${(caps.maxVideoBytes / 1024 ** 3).toFixed(1)} GB upload limit.`,
            fix: { kind: "compress_media", label: "Compress a copy", mediaId: v.id, provider: account.provider },
          });
        }
      }

      // Image limits.
      for (const img of images) {
        if (caps.maxImageBytes > 0 && img.bytes > caps.maxImageBytes) {
          add({
            provider: account.provider,
            accountId: account.id,
            severity: "warning",
            title: `Image is larger than ${pn} allows`,
            message: `“${img.filename}” will be compressed before upload.`,
            fix: { kind: "compress_media", label: "Compress a copy", mediaId: img.id, provider: account.provider },
          });
        }
        if (
          (account.provider === "instagram" || account.provider === "pinterest") &&
          img.aspectRatio &&
          !caps.aspectRatios.includes(img.aspectRatio)
        ) {
          const target = caps.aspectRatios[0];
          add({
            provider: account.provider,
            accountId: account.id,
            severity: "warning",
            title: `${img.aspectRatio} isn't a native ${pn} ratio`,
            message: `${pn} prefers ${caps.aspectRatios.join(", ")}. We can crop a copy to ${target} — the original stays untouched.`,
            fix: { kind: "crop_media", label: `Crop a copy to ${target}`, mediaId: img.id, aspect: target, provider: account.provider },
          });
        }
      }

      // Image count limits.
      if (caps.maxImages > 0 && images.length > caps.maxImages) {
        add({
          provider: account.provider,
          accountId: account.id,
          severity: "warning",
          title: `${pn} accepts at most ${caps.maxImages} images`,
          message: `Only the first ${caps.maxImages} will be published to ${pn}.`,
        });
      }
    }

    // Caption length against the effective (variant) caption.
    const caption = effectiveCaption(input, account.provider);
    if (caption.length > caps.maxCaptionLength) {
      add({
        provider: account.provider,
        accountId: account.id,
        severity: caps.maxCaptionLength <= 500 ? "error" : "warning",
        title: `Caption exceeds ${pn}'s limit`,
        message: `${caption.length} characters — ${pn} allows ${caps.maxCaptionLength}.`,
        fix: {
          kind: "trim_caption",
          label: `Trim a ${pn} version to ${caps.maxCaptionLength}`,
          targetLength: caps.maxCaptionLength,
          provider: account.provider,
        },
      });
    }

    // Provider-required fields.
    if (account.provider === "youtube") {
      const v = variant(input, "youtube");
      if (videos.length > 0) {
        if (!v?.title) {
          add({
            provider: "youtube",
            accountId: account.id,
            severity: "error",
            title: "YouTube needs a title",
            message: "Videos on YouTube require a title of up to 100 characters.",
            fix: { kind: "open_variant", label: "Add a YouTube title", provider: "youtube", field: "title" },
          });
        }
        if (!v?.settings.visibility) {
          add({
            provider: "youtube",
            accountId: account.id,
            severity: "tip",
            title: "Choose YouTube visibility",
            message: "Public, unlisted or private — defaults to public.",
            fix: { kind: "open_variant", label: "Open YouTube settings", provider: "youtube", field: "visibility" },
          });
        }
      }
    }
    if (account.provider === "pinterest" && media.length > 0 && !variant(input, "pinterest")?.settings.boardId) {
      add({
        provider: "pinterest",
        accountId: account.id,
        severity: "warning",
        title: "Choose a Pinterest board",
        message: "Every Pin needs a destination board.",
        fix: { kind: "open_variant", label: "Select a board", provider: "pinterest", field: "board" },
      });
    }
    if (account.provider === "tiktok" && videos.length > 0 && !variant(input, "tiktok")?.settings.privacyOption) {
      add({
        provider: "tiktok",
        accountId: account.id,
        severity: "warning",
        title: "TikTok privacy is required",
        message: "TikTok asks that visibility is chosen explicitly for every post.",
        fix: { kind: "open_variant", label: "Open TikTok settings", provider: "tiktok", field: "privacy" },
      });
    }
  }

  const order = { error: 0, warning: 1, tip: 2 } as const;
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
