"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { useSession, useToast } from "@/components/providers";
import { DATA_MODE } from "@/lib/api/client";

export default function SignInPage() {
  const router = useRouter();
  const { session, signIn } = useSession();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session) router.replace("/dashboard");
  }, [session, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) next.email = "Enter a valid email address.";
    if (password.length < 1) next.password = "Enter your password.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 900));
    try {
      await signIn(email, password);
    } catch (err) {
      setLoading(false);
      setErrors({ password: (err as Error).message || "Sign-in failed. Check your credentials." });
      return;
    }
    toast({ title: "Welcome back", description: "Signed in successfully.", variant: "success" });
    router.push("/dashboard");
  };

  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight">Sign in to Aria Hub</h1>
      <p className="mt-1.5 text-sm text-ink-2">Pick up where your schedule left off.</p>

      <form onSubmit={submit} className="mt-7 flex flex-col gap-4" noValidate>
        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!errors.email}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password}
          />
        </Field>
        <div className="flex items-center justify-between text-[13px]">
          <Link href="/forgot-password" className="font-medium text-accent-ink hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" loading={loading}>
          Sign in
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-[12px] text-ink-3">
        <span className="h-px flex-1 bg-line" />
        demo build
        <span className="h-px flex-1 bg-line" />
      </div>
      {DATA_MODE === "mock" && (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            void signIn();
            router.push("/dashboard");
          }}
        >
          Continue as Maya (demo workspace)
        </Button>
      )}

      <p className="mt-8 text-center text-sm text-ink-2">
        New to Aria Hub?{" "}
        <Link href="/signup" className="font-semibold text-accent-ink hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
