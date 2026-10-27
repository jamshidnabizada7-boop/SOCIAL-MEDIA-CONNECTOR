import { eq } from "drizzle-orm";
import { socialProviders, type AriaDatabase } from "@aria/db";
import { isProviderConfigured, providerName } from "@aria/providers-core";
import type { ConnectionOption, ProviderId } from "@aria/shared-types";

export async function connectionOption(db: AriaDatabase, provider: ProviderId): Promise<ConnectionOption> {
  if (provider === "tiktok") return {
    provider, status: "unsupported",
    message: "TikTok publishing is not available in Aria Hub yet. Connecting will be enabled when the integration is ready.",
  };
  const [entry] = await db.select({ status: socialProviders.status }).from(socialProviders).where(eq(socialProviders.id, provider));
  if (entry?.status === "disabled" || entry?.status === "maintenance") return {
    provider, status: "unavailable", message: `${providerName(provider)} connections are temporarily unavailable. The platform administrator needs to restore this integration.`,
  };
  try {
    if (!(await isProviderConfigured(db, provider))) return {
      provider, status: "setup_required", message: `${providerName(provider)} setup is incomplete. The platform administrator must configure and activate its developer app before accounts can connect.`,
    };
  } catch {
    return { provider, status: "setup_required", message: `${providerName(provider)} credentials could not be loaded. The platform administrator needs to repair this integration.` };
  }
  return {
    provider, status: "available",
    message: provider === "bluesky" ? "Connect with an app password" : provider === "mastodon" ? "Sign in on your Mastodon server" : "Continue to the network to authorize access",
  };
}
