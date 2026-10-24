import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import {
  mediaAssets,
  postMedia,
  workspaceMembers,
} from "@aria/db";
import { verifyMediaSignature } from "@aria/db";
import { checksumOf, defaultStorage, detectMime, inspectImage } from "@aria/media-core";
import { requireWorkspacePermission } from "../../plugins/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { checkStorageLimit } from "../../lib/limits.js";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB per file (per-request cap)

export function registerMediaRoutes(app: FastifyInstance): void {
  const db = app.database.db;
  const storage = defaultStorage();

  /**
   * Multipart upload. Pipeline per plan §18: bytes in → content-sniff the
   * real type → checksum dedupe → inspect dimensions → object storage →
   * media_assets row. The original is never modified.
   */
  app.post(
    "/v1/workspaces/:workspaceId/media/upload",
    {
      preHandler: requireWorkspacePermission(app, "create_posts"),
      // bodyLimit must cover the multipart payload.
      bodyLimit: MAX_UPLOAD_BYTES + 64 * 1024,
    },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const data = await req.file({
        limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      });
      if (!data) {
        return reply.status(400).send({ error: { code: "no_file", message: "Attach a file as multipart/form-data field \"file\"." } });
      }
      const bytes = Buffer.from(await data.toBuffer());

      // Content sniff — reject anything we can't identify.
      const detected = detectMime(bytes);
      if (!detected) {
        return reply.status(415).send({
          error: { code: "unsupported_type", message: "Unrecognized file content. Supported: PNG, JPEG, GIF, WebP, MP4/MOV, WebM, PDF." },
        });
      }

      // Checksum dedupe within the workspace.
      const checksum = checksumOf(bytes);
      const existing = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.workspaceId, workspaceId), eq(mediaAssets.checksum, checksum)))
        .limit(1);
      if (existing[0]) {
        return reply.status(200).send({ media: existing[0], deduplicated: true });
      }

      const limit = await checkStorageLimit(db, workspaceId, bytes.byteLength);
      if (limit) return reply.status(402).send({ error: limit });

      // Inspection (images get real dimensions).
      let width: number | undefined;
      let height: number | undefined;
      let aspectRatio: string | undefined;
      if (detected.kind === "image") {
        const inspection = await inspectImage(bytes);
        if (inspection) {
          width = inspection.width;
          height = inspection.height;
          aspectRatio = inspection.aspectRatio;
        }
      }

      const { storageKey } = await storage.save(workspaceId, bytes, data.filename);
      const [asset] = await db
        .insert(mediaAssets)
        .values({
          workspaceId,
          uploadedBy: req.user!.id,
          kind: detected.kind,
          filename: data.filename.slice(0, 160),
          mime: data.mimetype || "application/octet-stream",
          detectedMime: detected.mime,
          bytes: bytes.byteLength,
          width,
          height,
          aspectRatio,
          checksum,
          storageKey,
          status: "ready",
        })
        .returning();

      await writeAudit(db, {
        workspaceId,
        actorUserId: req.user!.id,
        action: "media.uploaded",
        targetType: "media",
        targetId: asset.id,
        targetLabel: asset.filename,
        metadata: { bytes: asset.bytes, detectedMime: detected.mime },
        ip: req.ip,
      });

      return reply.status(201).send({ media: { ...asset, url: `/v1/media/${asset.id}/raw` }, deduplicated: false });
    }
  );

  /** Raw content. Auth-scoped: any workspace member of the asset. */
  app.get("/v1/media/:mediaId/raw", async (req, reply) => {
    if (!req.user) {
      return reply.status(401).send({ error: { code: "unauthenticated", message: "Sign in to continue." } });
    }
    const { mediaId } = req.params as { mediaId: string };
    const asset = (
      await db.select().from(mediaAssets).where(eq(mediaAssets.id, mediaId)).limit(1)
    )[0];
    if (!asset?.storageKey) {
      return reply.status(404).send({ error: { code: "not_found", message: "Media not found." } });
    }
    const member = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, asset.workspaceId),
          eq(workspaceMembers.userId, req.user.id),
          eq(workspaceMembers.status, "active")
        )
      )
      .limit(1);
    if (!member[0]) {
      return reply.status(404).send({ error: { code: "not_found", message: "Media not found." } });
    }
    try {
      const buffer = await storage.read(asset.storageKey);
      return reply
        .header("Content-Type", asset.detectedMime)
        .header("Content-Length", buffer.byteLength)
        .header("Cache-Control", "private, max-age=86400, immutable")
        .send(buffer);
    } catch {
      return reply.status(404).send({ error: { code: "not_found", message: "Media content missing." } });
    }
  });

  /**
   * Expiring public URL for providers that fetch media themselves (Instagram,
   * Threads). The worker signs `exp`/`sig` with a key derived from
   * ARIA_ENCRYPTION_KEY; nothing else can mint one.
   */
  app.get("/v1/media/:mediaId/public", async (req, reply) => {
    const { mediaId } = req.params as { mediaId: string };
    const { exp, sig } = req.query as { exp?: string; sig?: string };
    if (!verifyMediaSignature(mediaId, exp, sig)) {
      return reply.status(403).send({ error: { code: "invalid_signature", message: "This media link is invalid or has expired." } });
    }
    const asset = (await db.select().from(mediaAssets).where(eq(mediaAssets.id, mediaId)).limit(1))[0];
    if (!asset?.storageKey) {
      return reply.status(404).send({ error: { code: "not_found", message: "Media not found." } });
    }
    try {
      const buffer = await storage.read(asset.storageKey);
      return reply
        .header("Content-Type", asset.detectedMime)
        .header("Content-Length", buffer.byteLength)
        .header("Cache-Control", "public, max-age=3600")
        .send(buffer);
    } catch {
      return reply.status(404).send({ error: { code: "not_found", message: "Media content missing." } });
    }
  });

  app.get(
    "/v1/workspaces/:workspaceId/media",
    { preHandler: requireWorkspacePermission(app) },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const rows = await db
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.workspaceId, workspaceId))
        .orderBy(desc(mediaAssets.createdAt))
        .limit(200);
      return reply.send({
        media: rows.map((m) => ({ ...m, url: m.storageKey ? `/v1/media/${m.id}/raw` : null })),
      });
    }
  );

  app.patch(
    "/v1/workspaces/:workspaceId/media/:mediaId",
    { preHandler: requireWorkspacePermission(app, "edit_posts") },
    async (req, reply) => {
      const { workspaceId, mediaId } = req.params as { workspaceId: string; mediaId: string };
      const { altText } = req.body as { altText?: string };
      if (altText !== undefined && altText.length > 1000) {
        return reply.status(400).send({ error: { code: "invalid_input", message: "Alt text is capped at 1000 characters." } });
      }
      const [updated] = await db
        .update(mediaAssets)
        .set({ altText: altText ?? null })
        .where(and(eq(mediaAssets.id, mediaId), eq(mediaAssets.workspaceId, workspaceId)))
        .returning();
      if (!updated) return reply.status(404).send({ error: { code: "not_found", message: "Media not found." } });
      return reply.send({ media: updated });
    }
  );

  app.delete(
    "/v1/workspaces/:workspaceId/media/:mediaId",
    { preHandler: requireWorkspacePermission(app, "edit_posts") },
    async (req, reply) => {
      const { workspaceId, mediaId } = req.params as { workspaceId: string; mediaId: string };
      const asset = (
        await db
          .select()
          .from(mediaAssets)
          .where(and(eq(mediaAssets.id, mediaId), eq(mediaAssets.workspaceId, workspaceId)))
          .limit(1)
      )[0];
      if (!asset) return reply.status(404).send({ error: { code: "not_found", message: "Media not found." } });
      const used = await db.select({ postId: postMedia.postId }).from(postMedia).where(eq(postMedia.mediaId, mediaId)).limit(1);
      if (used[0]) {
        return reply.status(409).send({
          error: { code: "in_use", message: "This asset is attached to a post. Remove it from the post first." },
        });
      }
      await db.delete(mediaAssets).where(eq(mediaAssets.id, mediaId));
      if (asset.storageKey) await storage.remove(asset.storageKey);
      await writeAudit(db, {
        workspaceId,
        actorUserId: req.user!.id,
        action: "media.deleted",
        targetType: "media",
        targetId: mediaId,
        targetLabel: asset.filename,
        ip: req.ip,
      });
      return reply.status(204).send();
    }
  );
}
