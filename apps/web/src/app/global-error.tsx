"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/telemetry-client";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { reportClientError(error); }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1.5rem", maxWidth: "36rem", margin: "auto" }}>
        <h1>Something went wrong</h1>
        <p>We couldn&apos;t load this page. Please try again.</p>
        <button type="button" onClick={retry}>Try again</button>
        <p><a href="/dashboard">Return to your workspace</a></p>
      </body>
    </html>
  );
}
