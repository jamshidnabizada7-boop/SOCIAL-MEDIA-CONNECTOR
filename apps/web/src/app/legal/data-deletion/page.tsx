import type { Metadata } from "next";
import Link from "next/link";
import { OPERATOR } from "../operator";

export const metadata: Metadata = { title: "Data Deletion — Aria Hub" };

/** Public data-deletion instructions (the "Data Deletion Instructions URL" Meta requires). */
export default function DataDeletionPage() {
  return (
    <>
      <h1>Deleting your data</h1>
      <p>You can remove your data from Aria Hub at any time, in whole or in part.</p>

      <h2>Disconnect a social account</h2>
      <p>
        In Aria Hub open <strong>Accounts</strong>, choose the account and select <strong>Disconnect</strong>. We revoke
        the token where the network allows it and delete the stored, encrypted credential immediately. You can also
        remove Aria Hub from the network&apos;s own settings (for Facebook: Settings &amp; privacy → Settings → Business
        integrations / Apps and websites → Aria Hub → Remove); we then lose access and the connection shows as needing
        reconnection.
      </p>

      <h2>Delete a workspace</h2>
      <p>
        Owners can open <strong>Settings → Danger zone → Delete this workspace</strong>. Scheduled posts stop at once;
        posts, media, connections and analytics for the workspace are permanently erased within 30 days.
      </p>

      <h2>Delete your account</h2>
      <p>
        Open <strong>Settings → Danger zone → Delete your account</strong> and confirm with your password. Workspaces you
        own alone are deleted with it. If you own a workspace that has other members, make someone else the owner first
        (Team → Make owner).
      </p>

      <h2>Can&apos;t sign in?</h2>
      <p>
        Email <a href={`mailto:${OPERATOR.email}?subject=Data%20deletion%20request`}>{OPERATOR.email}</a> from the address on
        the account and ask for deletion. We confirm and complete verified requests within 30 days.
      </p>

      <p>
        Content already published to a social network stays on that network — delete it there if you want it removed.
        See the <Link href="/legal/privacy">Privacy Policy</Link> for details on what we store.
      </p>
    </>
  );
}
