"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { useSession, useToast } from "@/components/providers";

export default function SignUpPage() {
  const router = useRouter();
  const { session, signUp } = useSession();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session) router.replace("/dashboard");
  }, [session, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = "Tell us your name.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) next.email = "Enter a valid email address.";
    if (password.length < 8) next.password = "Use at least 8 characters.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    try {
      await signUp(name.trim(), email, password);
    } catch (err) {
      setLoading(false);
      setErrors({ email: (err as Error).message || "Could not create the account." });
      return;
    }
    toast({ title: "Account created", description: "Let's set up your workspace.", variant: "success" });
    router.push("/onboarding");
  };

  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        Two minutes to your first cross-network post.
      </p>

      <form onSubmit={submit} className="mt-7 flex flex-col gap-4" noValidate>
        <Field label="Full name" htmlFor="name" error={errors.name}>
          <Input
            id="name"
            autoComplete="name"
            placeholder="Maya Chen"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!errors.name}
          />
        </Field>
        <Field label="Work email" htmlFor="email" error={errors.email}>
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
        <Field
          label="Password"
          htmlFor="password"
          error={errors.password}
          hint="At least 8 characters."
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password}
          />
        </Field>
        <Button type="submit" size="lg" loading={loading}>
          Create account
        </Button>
      </form>

      <p className="mt-5 text-[12px] leading-relaxed text-ink-3">
        By creating an account you agree to the terms of service and privacy policy. Social
        accounts are connected through official authorization — we never see your network
        passwords.
      </p>

      <p className="mt-8 text-center text-sm text-ink-2">
        Already have an account?{" "}
        <Link href="/signin" className="font-semibold text-accent-ink hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
