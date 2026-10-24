import { createHash } from "node:crypto";

/** Content kinds the platform supports. */
export type MediaKind = "image" | "video" | "document";

export interface DetectedMime {
  mime: string;
  kind: MediaKind;
}

/**
 * Content-sniffs the actual bytes — never trust the client-provided content
 * type or extension (plan §18: validate actual file content).
 */
export function detectMime(bytes: Uint8Array): DetectedMime | null {
  if (bytes.length < 12) return null;
  const b = bytes;

  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { mime: "image/png", kind: "image" };
  }
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mime: "image/jpeg", kind: "image" };
  }
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { mime: "image/gif", kind: "image" };
  }
  // WEBP (RIFF....WEBP)
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return { mime: "image/webp", kind: "image" };
  }
  // MP4 / MOV — ftyp box at offset 4
  if (
    b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70
  ) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand.startsWith("qt")) return { mime: "video/quicktime", kind: "video" };
    return { mime: "video/mp4", kind: "video" };
  }
  // WebM (EBML)
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return { mime: "video/webm", kind: "video" };
  }
  // PDF
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    return { mime: "application/pdf", kind: "document" };
  }
  return null;
}

export function checksumOf(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function simplifyRatio(w: number, h: number): string {
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
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h) || 1;
  return `${Math.round(w / g)}:${Math.round(h / g)}`;
}

export interface ImageInspection {
  width: number;
  height: number;
  aspectRatio: string;
}

/** Inspects PNG/JPEG dimensions (pure JS; GIF/WebP parse via image-size too). */
export async function inspectImage(bytes: Uint8Array): Promise<ImageInspection | null> {
  try {
    const { imageSize } = await import("image-size");
    const result = imageSize(Buffer.from(bytes));
    if (!result.width || !result.height) return null;
    return {
      width: result.width,
      height: result.height,
      aspectRatio: simplifyRatio(result.width, result.height),
    };
  } catch {
    return null;
  }
}
