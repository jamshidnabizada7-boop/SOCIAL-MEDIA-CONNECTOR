import { createDatabase } from "./index.js";
import { featureFlags, plans, socialProviders } from "./schema/index.js";
import type { ProviderCapabilities, ProviderId } from "@aria/shared-types";

/**
 * Seeds plans, the provider capability registry and feature flags.
 * Idempotent — safe to run repeatedly.
 */

const PLANS = [
  { id: "free", name: "Free", priceMonthlyCents: 0, maxChannels: 3, maxBrands: 1, maxMembers: 1, maxScheduledPosts: 50, storageGb: 1, aiCredits: 0, features: ["3 connected channels", "1 brand", "Unlimited drafts", "50 scheduled posts / month", "1 GB media storage"] },
  { id: "creator", name: "Creator", priceMonthlyCents: 1900, maxChannels: 10, maxBrands: 3, maxMembers: 3, maxScheduledPosts: null, storageGb: 50, aiCredits: 500, features: ["10 connected channels", "3 brands", "Unlimited scheduled posts", "50 GB media storage", "500 AI credits / month"] },
  { id: "pro", name: "Pro", priceMonthlyCents: 4900, maxChannels: 25, maxBrands: 10, maxMembers: 10, maxScheduledPosts: null, storageGb: 250, aiCredits: 2000, features: ["25 connected channels", "10 brands", "10 team seats", "Unlimited scheduled posts", "250 GB storage", "2,000 AI credits / month", "API access (beta)"] },
  { id: "agency", name: "Agency", priceMonthlyCents: 14900, maxChannels: null, maxBrands: 100, maxMembers: 100, maxScheduledPosts: null, storageGb: 1000, aiCredits: 10000, features: ["Unlimited channels & workspaces", "Approval workflows", "Client reporting exports", "1 TB storage", "Priority support"] },
];

function caps(p: Partial<ProviderCapabilities>): ProviderCapabilities {
  return {
    formats: { text: false, image: false, video: false, document: false, carousel: false },
    altText: false,
    linkPreview: false,
    hashtags: true,
    firstComment: false,
    thumbnail: false,
    customCover: false,
    privacyControl: false,
    schedule: true,
    directPublish: true,
    manualPublishFallback: false,
    comments: false,
    analytics: false,
    deletion: false,
    editing: false,
    aiDisclosure: false,
    brandedContent: false,
    maxCaptionLength: 2000,
    maxImages: 1,
    maxVideoDurationSec: 600,
    maxVideoBytes: 1_000_000_000,
    maxImageBytes: 8_000_000,
    aspectRatios: [],
    ...p,
  } as ProviderCapabilities;
}

// Values are synced from docs/phase-0/PROVIDER-MATRIX.md (Phase 0 research).
const PROVIDERS: Array<{ id: ProviderId; name: string; approval: "approved" | "pending" | "testing"; apiVersion: string; capabilities: ProviderCapabilities }> = [
  { id: "facebook", name: "Facebook", approval: "approved", apiVersion: "v23.0", capabilities: caps({ formats: { text: true, image: true, video: true, document: false, carousel: true }, altText: true, linkPreview: true, firstComment: true, thumbnail: true, privacyControl: true, comments: true, analytics: true, deletion: true, editing: true, aiDisclosure: true, brandedContent: true, maxCaptionLength: 63206, maxImages: 10, maxVideoDurationSec: 14400, maxVideoBytes: 10_000_000_000, maxImageBytes: 4_000_000, aspectRatios: ["16:9", "1:1", "4:5", "9:16"] }) },
  { id: "instagram", name: "Instagram", approval: "approved", apiVersion: "v23.0", capabilities: caps({ formats: { text: false, image: true, video: true, document: false, carousel: true }, altText: true, hashtags: true, firstComment: true, manualPublishFallback: true, comments: true, analytics: true, deletion: true, aiDisclosure: true, brandedContent: true, maxCaptionLength: 2200, maxImages: 20, maxVideoDurationSec: 900, maxVideoBytes: 1_000_000_000, maxImageBytes: 8_000_000, aspectRatios: ["1:1", "4:5", "9:16"] }) },
  { id: "threads", name: "Threads", approval: "approved", apiVersion: "v1.0", capabilities: caps({ formats: { text: true, image: true, video: true, document: false, carousel: true }, altText: true, linkPreview: true, maxCaptionLength: 500, maxImages: 20, maxVideoDurationSec: 300, maxVideoBytes: 1_000_000_000, maxImageBytes: 8_000_000, aspectRatios: ["1:1", "4:5", "9:16"] }) },
  { id: "linkedin", name: "LinkedIn", approval: "approved", apiVersion: "202609", capabilities: caps({ formats: { text: true, image: true, video: true, document: true, carousel: false }, altText: true, linkPreview: true, firstComment: true, thumbnail: true, privacyControl: true, comments: true, analytics: true, deletion: true, editing: true, aiDisclosure: true, brandedContent: true, maxCaptionLength: 3000, maxImages: 20, maxVideoDurationSec: 600, maxVideoBytes: 5_000_000_000, maxImageBytes: 8_000_000, aspectRatios: ["1:1", "4:5", "16:9", "9:16"] }) },
  { id: "tiktok", name: "TikTok", approval: "pending", apiVersion: "v3", capabilities: caps({ formats: { text: false, image: true, video: true, document: false, carousel: true }, thumbnail: true, customCover: true, privacyControl: true, manualPublishFallback: true, analytics: true, aiDisclosure: true, brandedContent: true, maxCaptionLength: 2200, maxImages: 0, maxVideoDurationSec: 600, maxVideoBytes: 1_000_000_000, maxImageBytes: 20_000_000, aspectRatios: ["9:16", "1:1", "16:9"], note: "Privacy is selected for every post. Unaudited apps use the upload-as-draft flow." }) },
  { id: "youtube", name: "YouTube", approval: "testing", apiVersion: "v3", capabilities: caps({ formats: { text: false, image: false, video: true, document: false, carousel: false }, linkPreview: true, firstComment: true, thumbnail: true, customCover: true, privacyControl: true, comments: true, analytics: true, deletion: true, editing: true, aiDisclosure: true, brandedContent: true, maxCaptionLength: 5000, maxImages: 0, maxVideoDurationSec: 43200, maxVideoBytes: 256_000_000_000, maxImageBytes: 2_000_000, aspectRatios: ["16:9", "9:16"], note: "Title (max 100 chars) and description are required. Public auto-publish depends on API audit status." }) },
  { id: "x", name: "X", approval: "approved", apiVersion: "v2", capabilities: caps({ formats: { text: true, image: true, video: true, document: false, carousel: false }, altText: true, linkPreview: true, thumbnail: true, comments: true, analytics: true, deletion: true, maxCaptionLength: 280, maxImages: 4, maxVideoDurationSec: 140, maxVideoBytes: 512_000_000, maxImageBytes: 5_000_000, aspectRatios: ["16:9", "1:1"], note: "Posting requires a paid API tier; Free tier is read-only." }) },
  { id: "pinterest", name: "Pinterest", approval: "approved", apiVersion: "v5", capabilities: caps({ formats: { text: false, image: true, video: true, document: false, carousel: false }, altText: true, linkPreview: true, analytics: true, deletion: true, brandedContent: true, maxCaptionLength: 500, maxImages: 1, maxVideoDurationSec: 900, maxVideoBytes: 2_000_000_000, maxImageBytes: 20_000_000, aspectRatios: ["2:3", "1:1", "9:16"], note: "A board must be selected for every Pin." }) },
  { id: "bluesky", name: "Bluesky", approval: "approved", apiVersion: "atproto", capabilities: caps({ formats: { text: true, image: true, video: true, document: false, carousel: false }, altText: true, linkPreview: true, deletion: true, maxCaptionLength: 300, maxImages: 4, maxVideoDurationSec: 60, maxVideoBytes: 50_000_000, maxImageBytes: 1_000_000, aspectRatios: ["1:1", "16:9", "4:5"], note: "Self-serve app passwords or atproto OAuth; no app review. Analytics are not exposed." }) },
  { id: "mastodon", name: "Mastodon", approval: "approved", apiVersion: "4.3", capabilities: caps({ formats: { text: true, image: true, video: true, document: false, carousel: false }, altText: true, linkPreview: true, thumbnail: true, privacyControl: true, comments: true, deletion: true, editing: true, maxCaptionLength: 500, maxImages: 4, maxVideoBytes: 0, maxImageBytes: 16_000_000, aspectRatios: ["1:1", "16:9", "4:5"], note: "Federated — limits vary by instance and are read from /api/v2/instance." }) },
];

const FLAGS = [
  { key: "provider_tiktok_direct_publish", description: "TikTok Direct Post for audited apps (otherwise upload-as-draft).", enabled: false, rollout: "internal" },
  { key: "provider_youtube_publish", description: "YouTube publishing pipeline (pending API audit).", enabled: true, rollout: "beta" },
  { key: "ai_caption_adaptation", description: "“Adapt for each network” in the composer.", enabled: true, rollout: "all" },
  { key: "analytics_v2", description: "Normalized analytics warehouse and comparisons.", enabled: false, rollout: "percentage" },
  { key: "approval_workflows", description: "Draft → review → approved flow for workspaces.", enabled: true, rollout: "beta" },
];

const { db, close } = await createDatabase();
console.log("Seeding plans, providers and feature flags …");

for (const plan of PLANS) {
  await db.insert(plans).values(plan).onConflictDoNothing();
}
for (const p of PROVIDERS) {
  await db
    .insert(socialProviders)
    .values({ id: p.id, name: p.name, approval: p.approval, apiVersion: p.apiVersion, capabilities: p.capabilities, verifiedAt: new Date("2026-09-30") })
    .onConflictDoUpdate({
      target: socialProviders.id,
      set: { name: p.name, approval: p.approval, apiVersion: p.apiVersion, capabilities: p.capabilities, verifiedAt: new Date("2026-09-30"), updatedAt: new Date() },
    });
}
for (const flag of FLAGS) {
  await db.insert(featureFlags).values(flag).onConflictDoNothing();
}

console.log("Seed complete.");
await close();
