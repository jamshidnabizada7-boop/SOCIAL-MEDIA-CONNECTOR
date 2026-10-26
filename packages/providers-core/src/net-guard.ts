import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard for user-supplied server URLs (Mastodon instances, Bluesky
 * PDSes). The API fetches these server-side, so a hostile value could
 * otherwise reach the VPS's own services or the cloud metadata endpoint.
 */

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const PRIVATE_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function isPrivateV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return PRIVATE_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

function isPrivateV6(ip: string): boolean {
  // URL normalization compresses expanded forms and converts mapped dotted
  // addresses to hex; handle both forms before checking global-unicast space.
  const lower = new URL(`http://[${ip}]/`).hostname.slice(1, -1).toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  const mappedHex = lower.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
  if (mappedHex) {
    const value = (parseInt(mappedHex[1], 16) * 65536) + parseInt(mappedHex[2], 16);
    return isPrivateV4([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join("."));
  }
  return (
    !/^[23]/.test(lower) || // only globally routable unicast (2000::/3)
    lower.startsWith("2002:") || // 6to4 can embed a private IPv4 destination
    lower.startsWith("2001:db8:") || // documentation-only
    lower.startsWith("fc") || // unique local fc00::/7
    lower.startsWith("fd") ||
    lower.startsWith("fe8") || // link-local fe80::/10
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff") // multicast
  );
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateV4(ip);
  if (family === 6) return isPrivateV6(ip);
  return true;
}

export class UnsafeHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeHostError";
  }
}

/** Plain-HTTP and private hosts are allowed only when explicitly opted in (local development). */
function allowPrivate(): boolean {
  return process.env.ARIA_ALLOW_PRIVATE_INSTANCES === "true" && process.env.NODE_ENV !== "production";
}

/** Synchronous checks on the URL itself (scheme, literal IPs, obvious internal names). */
export function assertSafeUrlShape(url: URL): void {
  if (allowPrivate()) return;
  if (url.protocol !== "https:") throw new UnsafeHostError("Server address must use https://");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new UnsafeHostError("That server address points to a private network.");
  }
  if (isIP(host) && isPrivateAddress(host)) {
    throw new UnsafeHostError("That server address points to a private network.");
  }
}

/** Resolves the host and refuses it if any address is private, loopback or link-local. */
export async function assertPublicHost(input: string): Promise<void> {
  const url = new URL(input);
  assertSafeUrlShape(url);
  if (allowPrivate()) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return; // literal already checked
  let addresses: Array<{ address: string }>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("DNS lookup timed out")), 5_000);
        timer.unref();
      }),
    ]);
  } catch {
    throw new UnsafeHostError("That server could not be found. Check the address.");
  } finally {
    clearTimeout(timer);
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeHostError("That server address points to a private network.");
  }
}
