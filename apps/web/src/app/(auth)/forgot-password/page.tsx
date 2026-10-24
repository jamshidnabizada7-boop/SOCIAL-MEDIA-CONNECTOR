"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleCheckBig, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { DATA_MODE } from "@/lib/api/client";
import { sessionApi } from "@/lib/api/session";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(undefined);
    setLoading(true);
    try {
      if (DATA_MODE === "api") await sessionApi.forgotPassword(email);
      else await new Promise((r) => setTimeout(r, 600));
      setSent(true);
    } catch (err) {
      setError((err as Error).message || "Couldn't send the link. Try again in a minute.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-success-soft text-success-ink">
          <CircleCheckBig className="size-5" aria-hidden />
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">Check your inbox</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          If an account exists for <span className="font-medium text-ink">{email}</span>, a reset
          link is on its way. The link expires in 1 hour.
        </p>
        <Button variant="secondary" className="mt-6 w-full" onClick={() => setSent(false)}>
          Use a different email
        </Button>
        <p className="mt-6 text-sm text-ink-2">
          <Link href="/signin" className="font-semibold text-accent-ink hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
        <Mail className="size-5" aria-hidden />
      </span>
      <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">Reset your password</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        Enter the email on your account and we&apos;ll send a reset link.
      </p>

      <form onSubmit={submit} className="mt-7 flex flex-col gap-4" noValidate>
        <Field label="Email" htmlFor="email" error={error}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!error}
          />
        </Field>
        <Button type="submit" size="lg" loading={loading}>
          Send reset link
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-ink-2">
        <Link href="/signin" className="font-semibold text-accent-ink hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
