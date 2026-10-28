import type { Metadata } from "next";
import Link from "next/link";
import { OPERATOR } from "../operator";

export const metadata: Metadata = { title: "Privacy Policy — Aria Hub" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="text-[13px] text-ink-3">Last updated {OPERATOR.updated}</p>
      <p>
        Aria Hub is a tool for composing posts once and publishing or scheduling them to the social networks you connect.
        This policy explains what data the service operated by {OPERATOR.entity} (&quot;we&quot;) processes, why, and the
        choices you have. Contact: <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>.
      </p>

      <h2>Data we process</h2>
      <ul>
        <li><strong>Account data</strong> — your name, email address, a salted hash of your password, sign-in records (IP address, browser) and your workspace memberships and roles.</li>
        <li><strong>Connected social accounts</strong> — the account or page id, name, handle, follower count and the access tokens the network issues when you authorize Aria Hub. Tokens are encrypted at rest (AES-256-GCM) and are never shown to anyone.</li>
        <li><strong>Content</strong> — the posts, captions, links, schedules and media you create or upload, and per-network settings.</li>
        <li><strong>Social Inbox</strong> — comments, mentions and replies returned by supported networks for your connected accounts, the sender&apos;s public profile details, conversation links, handling states, team assignments and replies your team chooses to send. Private messages are not currently collected.</li>
        <li><strong>Delivery and performance data</strong> — publish attempts, the network&apos;s post id and link, and engagement counts (for example likes, replies, reposts, views) that the network returns for posts published through Aria Hub.</li>
        <li><strong>Billing data</strong> — for paid plans, your subscription status. Card details are collected and stored by Stripe, never by us.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To publish and schedule the content you ask us to, to the accounts you connected, and to show you whether delivery succeeded.</li>
        <li>To keep connections working (refreshing tokens before they expire) and to alert you by in-app notification and, if enabled, email when something needs your attention.</li>
        <li>To show analytics about posts you published through Aria Hub.</li>
        <li>To synchronize supported social interactions into your workspace Inbox and send the replies your team requests, using the additional permissions you choose to grant.</li>
        <li>To secure the service (rate limiting, lockouts, audit logs) and to bill paid plans.</li>
      </ul>
      <p>We do not sell personal data, use it for advertising, or use your content to train machine-learning models.</p>

      <h2>Data from Google (YouTube)</h2>
      <p>
        Aria Hub&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. We request permission to upload videos to the YouTube channel you
        connect and to read that channel&apos;s basic information and video statistics, and use it only to publish the
        videos you schedule and to show their performance to you. Google user data is not transferred to third parties
        except as needed to provide this feature, for security, or as required by law, and humans do not read it unless
        you ask us to for support or it is necessary for security or legal reasons.
      </p>

      <h2>Data from Meta, LinkedIn, X, Pinterest, Bluesky and Mastodon</h2>
      <p>
        We use the permissions you grant each network only to publish the content you create in Aria Hub to the
        accounts and pages you select, to read the basic profile needed to identify them, and to read engagement on
        posts published through Aria Hub. You can revoke access at any time in Aria Hub (Accounts → Disconnect) or in
        the network&apos;s own settings.
      </p>

      <h2>Processors</h2>
      <p>
        We use infrastructure and service providers to run Aria Hub: our hosting provider (servers and database),
        Cloudflare (network delivery), our email delivery provider (transactional email) and Stripe (payments). Content
        you publish is, by design, sent to the social networks you choose.
      </p>

      <h2>Retention</h2>
      <ul>
        <li>Account and workspace data is kept while your account exists.</li>
        <li>When you delete a workspace or your account, scheduled posts stop immediately and the data — including uploaded media and connection tokens — is permanently erased within 30 days.</li>
        <li>Expired sign-in sessions and one-time links are removed automatically; webhook records after 90 days.</li>
        <li>Social Inbox content is retained for 90 days by default (the operator can configure 7–365 days). Webhook wakeup digests are removed after 7 days.</li>
        <li>Content already published to a network stays there; delete it on the network if you want it removed.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can access and export your workspace data (Settings → Danger zone → Download export), correct your profile,
        disconnect any social account, and delete your account (Settings → Danger zone). Depending on where you live you
        may also have the right to object to or restrict processing and to complain to a data-protection authority.
        To exercise any right, email <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>. See also{" "}
        <Link href="/legal/data-deletion">how to delete your data</Link>.
      </p>

      <h2>Security</h2>
      <p>
        Traffic is encrypted in transit (HTTPS). Passwords are hashed with bcrypt; social-network tokens are encrypted
        with a key held outside the database. Access to production systems is restricted and logged.
      </p>

      <h2>Changes</h2>
      <p>We will post changes here and, for material changes, notify account owners by email before they take effect.</p>
    </>
  );
}
