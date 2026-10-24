"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { useSession, useToast } from "@/components/providers";
import { sessionApi } from "@/lib/api/session";

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const { refresh } = useSession();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Reset link missing</h1>
        <p className="mt-2 text-sm text-ink-2">Open the link from your email again, or request a new one.</p>
        <Link href="/forgot-password" className="mt-6 inline-block text-sm font-semibold text-accent-ink hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (password.length < 8) next.password = "Use at least 8 characters.";
    if (confirm !== password) next.confirm = "The passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setLoading(true);
    try {
      await sessionApi.resetPassword(token, password);
    } catch (err) {
      setLoading(false);
      setErrors({ form: (err as Error).message || "This reset link is invalid or has expired." });
      return;
    }
    await refresh();
    toast({ title: "Password updated", description: "You're signed in. Other devices were signed out.", variant: "success" });
    router.push("/dashboard");
  };

  return (
    <div>
      <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
        <KeyRound className="size-5" aria-hidden />
      </span>
      <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-ink-2">Signing in with the new password signs out every other device.</p>

      <form onSubmit={submit} className="mt-7 flex flex-col gap-4" noValidate>
        <Field label="New password" htmlFor="password" error={errors.password}>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password}
          />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={errors.confirm ?? errors.form}>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={!!(errors.confirm ?? errors.form)}
          />
        </Field>
        <Button type="submit" size="lg" loading={loading}>
          Update password
        </Button>
      </form>
      {errors.form && (
        <p className="mt-4 text-center text-sm">
          <Link href="/forgot-password" className="font-semibold text-accent-ink hover:underline">
            Request a new link
          </Link>
        </p>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
