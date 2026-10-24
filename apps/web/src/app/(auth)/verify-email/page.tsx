"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { CircleCheckBig, CircleAlert } from "lucide-react";
import { Spinner } from "@/components/ui/primitives";
import { useSession } from "@/components/providers";
import { sessionApi } from "@/lib/api/session";

function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const { session, refresh } = useSession();
  const [state, setState] = useState<"working" | "done" | "error">(token ? "working" : "error");
  const [message, setMessage] = useState(token ? "" : "This confirmation link is missing its token.");
  const started = useRef(false);

  useEffect(() => {
    // Tokens are single-use: guard against the dev-mode double effect.
    if (!token || started.current) return;
    started.current = true;
    sessionApi
      .verifyEmail(token)
      .then(async () => {
        setState("done");
        await refresh();
      })
      .catch((err: Error) => {
        setState("error");
        setMessage(err.message || "This confirmation link is invalid or has expired.");
      });
  }, [token, refresh]);

  if (state === "working") {
    return (
      <div className="flex items-center gap-3 text-sm text-ink-2">
        <Spinner /> Confirming your email…
      </div>
    );
  }

  const ok = state === "done";
  return (
    <div className="text-center">
      <span
        className={
          ok
            ? "mx-auto flex size-11 items-center justify-center rounded-xl bg-success-soft text-success-ink"
            : "mx-auto flex size-11 items-center justify-center rounded-xl bg-danger-soft text-danger-ink"
        }
      >
        {ok ? <CircleCheckBig className="size-5" aria-hidden /> : <CircleAlert className="size-5" aria-hidden />}
      </span>
      <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">{ok ? "Email confirmed" : "Couldn't confirm"}</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">
        {ok ? "Thanks — your address is verified." : message}
        {!ok && session ? " You can send a fresh link from the banner in the app." : ""}
      </p>
      <Link
        href={session ? "/dashboard" : "/signin"}
        className="mt-6 inline-block text-sm font-semibold text-accent-ink hover:underline"
      >
        {session ? "Go to the dashboard" : "Sign in"}
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmail />
    </Suspense>
  );
}
