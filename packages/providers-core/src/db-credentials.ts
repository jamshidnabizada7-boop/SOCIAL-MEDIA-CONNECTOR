import { and, eq } from "drizzle-orm";
import type { AriaDatabase } from "@aria/db";
import { providerAppConfigs } from "@aria/db";
import { decryptSecret, encryptSecret } from "@aria/db";
import type { ProviderId } from "@aria/shared-types";
import { PROVIDER_OAUTH, providerCredentials as envCredentials } from "./config.js";

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
  /** Where the credential came from — useful for the admin UI. */
  source: "database" | "env";
}

/**
 * Instagram is a product inside the Facebook (Meta) developer app, so its
 * credentials live under the facebook row (env already behaves the same way).
 */
const CREDENTIAL_OWNER: Partial<Record<ProviderId, ProviderId>> = { instagram: "facebook" };

function credentialKey(provider: ProviderId): ProviderId {
  return CREDENTIAL_OWNER[provider] ?? provider;
}

/**
 * Resolves OAuth client credentials: database (Admin UI) first, then env.
 * This lets operators paste app credentials from the Admin panel without
 * editing server env files.
 */
export async function getProviderCredentials(
  db: AriaDatabase | null | undefined,
  provider: ProviderId
): Promise<ProviderCredentials | null> {
  if (!db) {
    const fromEnv = envCredentials(provider);
    return fromEnv ? { ...fromEnv, source: "env" } : null;
  }
  const rows = await db
    .select()
    .from(providerAppConfigs)
    .where(and(eq(providerAppConfigs.providerId, credentialKey(provider)), eq(providerAppConfigs.instanceUrl, "*")))
    .limit(1);
  if (rows[0]) {
    return {
      clientId: rows[0].clientId,
      clientSecret: decryptSecret(rows[0].clientSecretEnc),
      source: "database",
    };
  }
  const fromEnv = envCredentials(provider);
  return fromEnv ? { ...fromEnv, source: "env" } : null;
}

export async function isProviderConfigured(
  db: AriaDatabase | null | undefined,
  provider: ProviderId
): Promise<boolean> {
  if (provider === "bluesky" || provider === "mastodon") return true;
  return (await getProviderCredentials(db, provider)) !== null;
}

export async function setProviderCredentials(
  db: AriaDatabase,
  provider: ProviderId,
  credentials: { clientId: string; clientSecret: string }
): Promise<void> {
  const key = credentialKey(provider);
  await db
    .insert(providerAppConfigs)
    .values({
      providerId: key,
      instanceUrl: "*",
      clientId: credentials.clientId,
      clientSecretEnc: encryptSecret(credentials.clientSecret),
      scopes: PROVIDER_OAUTH[key as keyof typeof PROVIDER_OAUTH]?.scopes ?? [],
    })
    .onConflictDoUpdate({
      target: [providerAppConfigs.providerId, providerAppConfigs.instanceUrl],
      set: {
        clientId: credentials.clientId,
        clientSecretEnc: encryptSecret(credentials.clientSecret),
        updatedAt: new Date(),
      },
    });
}

export async function deleteProviderCredentials(db: AriaDatabase, provider: ProviderId): Promise<void> {
  await db
    .delete(providerAppConfigs)
    .where(and(eq(providerAppConfigs.providerId, credentialKey(provider)), eq(providerAppConfigs.instanceUrl, "*")));
}
