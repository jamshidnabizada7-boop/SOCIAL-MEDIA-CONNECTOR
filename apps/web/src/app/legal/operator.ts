/**
 * Operator details shown on the legal pages. Set these at build time:
 *   NEXT_PUBLIC_LEGAL_ENTITY    e.g. "Aria Hub Ltd., 1 Example Street, Berlin, Germany"
 *   NEXT_PUBLIC_CONTACT_EMAIL   e.g. "privacy@example.com"
 *   NEXT_PUBLIC_LEGAL_UPDATED   e.g. "2026-10-24"
 */
export const OPERATOR = {
  entity: process.env.NEXT_PUBLIC_LEGAL_ENTITY ?? "the operator of this Aria Hub service",
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "privacy@example.com",
  updated: process.env.NEXT_PUBLIC_LEGAL_UPDATED ?? "2026-10-24",
};
