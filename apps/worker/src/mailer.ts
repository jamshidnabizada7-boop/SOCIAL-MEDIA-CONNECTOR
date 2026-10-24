import { and, eq } from "drizzle-orm";
import { posts, users, workspaceMembers, workspaces } from "@aria/db";
import type { AriaDatabase } from "@aria/db";
import { resolveNotificationPrefs, type NotificationPrefs } from "@aria/shared-types";

/**
 * Email alerts for things that need a human: a failed destination or an
 * account that lost access. Same SMTP_URL / MAIL_FROM / APP_WEB_URL settings
 * as the API. Without SMTP_URL nothing is sent (in-app notifications remain).
 */

type Transport = { sendMail(msg: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown> };
let transport: Transport | null | undefined;

async function getTransport(): Promise<Transport | null> {
  if (transport !== undefined) return transport;
  if (!process.env.SMTP_URL) return (transport = null);
  const nodemailer = await import("nodemailer");
  transport = nodemailer.createTransport(process.env.SMTP_URL) as unknown as Transport;
  return transport;
}

function webAppUrl(): string {
  const explicit = process.env.APP_WEB_URL?.trim();
  const base = explicit || process.env.WEB_ORIGIN?.split(",")[0]?.trim() || "http://localhost:3000";
  return base.replace(/\/+$/, "");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const PREF_FOR_TYPE: Record<string, keyof NotificationPrefs> = {
  post_failed: "failures",
  needs_reauth: "reauth",
};

/** Roles that hear about delivery problems even when they didn't author the post. */
const ALERT_ROLES = ["owner", "admin", "manager"] as const;

export async function emailAlert(
  db: AriaDatabase,
  workspaceId: string,
  n: { type: string; title: string; body: string; postId?: string; accountId?: string },
  log: (msg: string, meta?: Record<string, unknown>) => void
): Promise<void> {
  const pref = PREF_FOR_TYPE[n.type];
  if (!pref) return;
  const t = await getTransport();
  if (!t) return;
  try {
    const ws = (await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0];
    const authorId = n.postId
      ? (await db.select({ authorId: posts.authorId }).from(posts).where(eq(posts.id, n.postId)).limit(1))[0]?.authorId
      : undefined;
    const members = await db
      .select({ userId: users.id, email: users.email, prefs: users.notificationPrefs, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.status, "active"), eq(users.status, "active")));
    const recipients = members.filter(
      (m) =>
        (m.userId === authorId || (ALERT_ROLES as readonly string[]).includes(m.role)) &&
        resolveNotificationPrefs(m.prefs)[pref]
    );
    if (recipients.length === 0) return;
    const link = n.postId ? `${webAppUrl()}/posts/${n.postId}` : `${webAppUrl()}/accounts`;
    const subject = `[${ws?.name ?? "Aria Hub"}] ${n.title}`;
    const text = `${n.title}\n\n${n.body}\n\nOpen: ${link}\n\nYou get this because email alerts are on in Settings → Notifications.`;
    const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1f24">
<div style="max-width:480px;margin:24px auto;padding:24px;border:1px solid #e4e7e4;border-radius:12px">
<p style="font-size:12px;color:#6b7280;margin:0 0 8px">${escapeHtml(ws?.name ?? "Aria Hub")}</p>
<h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(n.title)}</h1>
<p style="font-size:14px;line-height:1.5">${escapeHtml(n.body)}</p>
<a href="${escapeHtml(link)}" style="display:inline-block;margin-top:12px;background:#0e7059;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Open in Aria Hub</a>
<p style="font-size:12px;color:#6b7280;margin-top:20px">Turn these emails off in Settings → Notifications.</p>
</div></body></html>`;
    const from = process.env.MAIL_FROM ?? "Aria Hub <no-reply@localhost>";
    await Promise.allSettled(recipients.map((r) => t.sendMail({ from, to: r.email, subject, text, html })));
  } catch (err) {
    log("email alert failed", { error: (err as Error).message });
  }
}

