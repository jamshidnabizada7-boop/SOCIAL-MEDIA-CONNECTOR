import type { FastifyBaseLogger } from "fastify";
import { config, isProd } from "../config.js";

/**
 * Transactional email. Configure SMTP_URL (e.g. smtps://user:pass@smtp.resend.com:465)
 * and MAIL_FROM ("Aria Hub <no-reply@example.com>").
 *
 * Without SMTP_URL: in development the message (with its link) is written to
 * the log so flows can be tested locally; in production nothing is logged
 * beyond a warning, because links in logs would be credentials.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  delivered: boolean;
}

type Transport = { sendMail(msg: MailMessage & { from: string }): Promise<unknown> };
let transport: Transport | null | undefined;

async function getTransport(): Promise<Transport | null> {
  if (transport !== undefined) return transport;
  const url = process.env.SMTP_URL;
  if (!url) {
    transport = null;
    return null;
  }
  const nodemailer = await import("nodemailer");
  transport = nodemailer.createTransport(url) as unknown as Transport;
  return transport;
}

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL);
}

/** Base URL of the web app, used in links inside emails. */
export function webAppUrl(): string {
  const explicit = process.env.APP_WEB_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const first = config.WEB_ORIGIN.split(",")[0]?.trim() || "http://localhost:3000";
  return first.replace(/\/+$/, "");
}

export async function sendMail(log: FastifyBaseLogger, msg: MailMessage): Promise<MailResult> {
  const t = await getTransport();
  if (!t) {
    if (isProd) {
      log.warn({ to: msg.to, subject: msg.subject }, "SMTP_URL not configured — email not sent");
    } else {
      log.info({ to: msg.to, subject: msg.subject, text: msg.text }, "email (dev, not sent)");
    }
    return { delivered: false };
  }
  try {
    await t.sendMail({ from: process.env.MAIL_FROM ?? "Aria Hub <no-reply@localhost>", ...msg });
    return { delivered: true };
  } catch (err) {
    log.error({ err, to: msg.to, subject: msg.subject }, "email delivery failed");
    return { delivered: false };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** One-button email body shared by every transactional template. */
export function actionEmail(opts: { heading: string; body: string; actionLabel: string; actionUrl: string; footer?: string }): {
  text: string;
  html: string;
} {
  const text = `${opts.heading}\n\n${opts.body}\n\n${opts.actionLabel}: ${opts.actionUrl}\n${opts.footer ? `\n${opts.footer}\n` : ""}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1f24">
<div style="max-width:480px;margin:32px auto;background:#fff;border-radius:12px;padding:32px">
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(opts.heading)}</h1>
<p style="font-size:15px;line-height:1.5;margin:0 0 24px">${escapeHtml(opts.body)}</p>
<a href="${escapeHtml(opts.actionUrl)}" style="display:inline-block;background:#3b5bdb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(opts.actionLabel)}</a>
<p style="font-size:12px;color:#6b7280;margin:24px 0 0">If the button doesn't work, paste this link into your browser:<br>${escapeHtml(opts.actionUrl)}</p>
${opts.footer ? `<p style="font-size:12px;color:#6b7280;margin:16px 0 0">${escapeHtml(opts.footer)}</p>` : ""}
</div></body></html>`;
  return { text, html };
}
