import { beforeAll, describe, expect, it } from "vitest";

/**
 * The OAuth credential vault round-trips through AES-256-GCM. This test needs
 * ARIA_ENCRYPTION_KEY set — it generates one for the test run.
 */
beforeAll(() => {
  process.env.ARIA_ENCRYPTION_KEY ??= "3f2a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c";
});

describe("credential encryption", () => {
  it("round-trips a provider access token", async () => {
    const { encryptSecret, decryptSecret } = await import("@aria/db");
    const token = "EAABsbCSjRaYBAF9exampleAccessTokenValue.1234567890";
    const enc = encryptSecret(token);
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain(token);
    expect(decryptSecret(enc)).toBe(token);
  });

  it("produces different ciphertexts for the same input (random IV)", async () => {
    const { encryptSecret } = await import("@aria/db");
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered ciphertext", async () => {
    const { encryptSecret, decryptSecret } = await import("@aria/db");
    const enc = encryptSecret("secret");
    const parts = enc.split(":");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
});
