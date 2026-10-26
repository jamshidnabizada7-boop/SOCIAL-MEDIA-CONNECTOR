"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/telemetry-client";

export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { reportClientError(error); }, [error]);
  return (
    <main className="mx-auto max-w-xl px-6 py-20">
      <h1 className="font-display text-2xl font-bold">We couldn&apos;t load this page</h1>
      <p className="mt-3 text-ink-2">Please try again. If the problem continues, return to your workspace.</p>
      <button type="button" onClick={retry} className="mt-6 rounded-lg bg-accent px-4 py-2 font-semibold text-white">Try again</button>
      <p className="mt-4"><a href="/dashboard" className="underline">Return to your workspace</a></p>
    </main>
  );
}
