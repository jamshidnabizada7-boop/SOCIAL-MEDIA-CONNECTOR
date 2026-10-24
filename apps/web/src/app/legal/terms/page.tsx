import type { Metadata } from "next";
import { OPERATOR } from "../operator";

export const metadata: Metadata = { title: "Terms of Service — Aria Hub" };

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="text-[13px] text-ink-3">Last updated {OPERATOR.updated}</p>
      <p>
        These terms govern your use of Aria Hub, operated by {OPERATOR.entity}. By creating an account you agree to them.
        Questions: <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>.
      </p>

      <h2>The service</h2>
      <p>
        Aria Hub lets you compose content once and publish or schedule it to social networks you connect. Each network
        decides what it accepts; we validate content against their published rules, but a network can still reject,
        delay, limit or remove a post. Aria Hub is not affiliated with or endorsed by any social network.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must provide accurate information and keep your password secure. You are responsible for activity in your account and workspaces.</li>
        <li>Workspace owners decide who has access and with which role.</li>
        <li>You must be old enough to form a binding contract where you live and to use the networks you connect.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        You keep all rights to the content you create or upload. You grant us the limited permission needed to store,
        process and transmit it to the networks you select, and to show it to members of your workspace. You confirm
        you have the rights to publish it.
      </p>

      <h2>Acceptable use</h2>
      <p>Do not use Aria Hub to:</p>
      <ul>
        <li>violate any network&apos;s terms, developer policies or automation rules, or any law;</li>
        <li>publish spam, misleading or deceptive content, malware, or content that infringes others&apos; rights;</li>
        <li>connect accounts you aren&apos;t authorized to manage;</li>
        <li>probe, disrupt or overload the service, or circumvent plan limits or security controls.</li>
      </ul>
      <p>We may suspend accounts that break these rules or put the service or the networks at risk.</p>

      <h2>Plans and payment</h2>
      <p>
        Paid plans are billed monthly in advance through Stripe and renew until canceled. Upgrades take effect
        immediately and are prorated; downgrades and cancellations take effect at the end of the paid period. Fees are
        non-refundable except where required by law. We will give at least 30 days&apos; notice of price changes.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep Aria Hub available and to publish on time, but the service is provided &quot;as is&quot;. Networks
        can change their APIs or revoke access without notice. We are not responsible for content a network rejects or
        removes, or for delays caused by a network.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent permitted by law, our total liability for any claim relating to the service is limited to the
        amount you paid us in the 12 months before the claim, and we are not liable for indirect or consequential
        losses. Nothing in these terms limits liability that cannot be limited by law.
      </p>

      <h2>Ending</h2>
      <p>
        You can delete your account at any time in Settings. We may end the service with reasonable notice. After an
        account or workspace is deleted, its data is erased within 30 days as described in the Privacy Policy.
      </p>

      <h2>Changes</h2>
      <p>We may update these terms; material changes are announced to account owners by email before they apply.</p>
    </>
  );
}
