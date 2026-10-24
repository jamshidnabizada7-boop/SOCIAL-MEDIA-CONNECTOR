import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * Object-storage abstraction (plan §18). Phase 3 uses the local disk; the S3
 * implementation swaps in behind the same interface without touching callers.
 * Keys are content-addressed per workspace: {workspaceId}/{checksum}/{filename}
 */

export interface StorageService {
  save(workspaceId: string, bytes: Uint8Array, filename: string): Promise<{ storageKey: string; bytes: number }>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}

/**
 * Finds the monorepo root by walking up from the process cwd looking for the
 * workspace marker (a package.json declaring npm workspaces). Node resolves
 * workspace dependencies through per-app symlink paths, so import.meta.url is
 * NOT stable across apps — cwd + marker is.
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (Array.isArray(pkg.workspaces)) return dir;
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir);
}

export class LocalDiskStorage implements StorageService {
  constructor(private rootDir: string) {}

  private resolve(key: string): string {
    // Defense against traversal: keys are rebuilt from sanitized segments.
    const safe = key
      .split("/")
      .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, "_"))
      .join("/");
    const resolved = path.resolve(this.rootDir, safe);
    if (!resolved.startsWith(path.resolve(this.rootDir))) {
      throw new Error("Invalid storage key");
    }
    return resolved;
  }

  async save(workspaceId: string, bytes: Uint8Array, filename: string): Promise<{ storageKey: string; bytes: number }> {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "file";
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `${workspaceId}/${checksum}/${safeName}`;
    const target = this.resolve(storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    return { storageKey, bytes: bytes.byteLength };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolve(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    await unlink(this.resolve(storageKey)).catch(() => {
      /* already gone */
    });
  }
}

export function defaultStorage(): StorageService {
  const root =
    process.env.ARIA_STORAGE_DIR ?? path.join(findRepoRoot(), ".local", "storage");
  return new LocalDiskStorage(root);
}
