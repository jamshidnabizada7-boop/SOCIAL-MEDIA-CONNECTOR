"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CircleAlert, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/primitives";
import { useSession, useToast } from "@/components/providers";
import { sessionApi, type InvitationPreview } from "@/lib/api/session";

function AcceptInvite() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const { session, ready, refresh, setWorkspace, signOut } = useSession();
  const toast = useToast();
  const [invite, setInvite] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState<string | null>(token ? null : "This invitation link is missing its token.");
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    sessionApi
      .invitation(token)
      .then(setInvite)
      .catch((err: Error) => setError(err.message || "This invitation is no longer valid."));
  }, [token]);

  const here = `/invite?token=${encodeURIComponent(token)}`;

  const accept = async () => {
    setAccepting(true);
    try {
      const { workspaceId } = await sessionApi.acceptInvitation(token);
      setWorkspace(workspaceId);
      await refresh();
      toast({ title: `You joined ${invite?.workspaceName ?? "the workspace"}`, variant: "success" });
      router.push("/dashboard");
    } catch (err) {
      setAccepting(false);
      setError((err as Error).message || "Couldn't accept the invitation.");
    }
  };

  if (error) {
    return (
      <div className="text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-danger-soft text-danger-ink">
          <CircleAlert className="size-5" aria-hidden />
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">Invitation unavailable</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{error}</p>
        <Link href={session ? "/dashboard" : "/signin"} className="mt-6 inline-block text-sm font-semibold text-accent-ink hover:underline">
          {session ? "Go to the dashboard" : "Sign in"}
        </Link>
      </div>
    );
  }

  if (!invite || !ready) {
    return (
      <div className="flex items-center gap-3 text-sm text-ink-2">
        <Spinner /> Loading the invitation…
      </div>
    );
  }

  const signedInAsInvitee = session && session.user.email.toLowerCase() === invite.email.toLowerCase();

  return (
    <div>
      <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
        <UsersRound className="size-5" aria-hidden />
      </span>
      <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">Join {invite.workspaceName}</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
        {invite.inviterName ? `${invite.inviterName} invited` : "You've been invited as"}{" "}
        {invite.inviterName ? <span className="font-medium text-ink">{invite.email}</span> : null}
        {invite.inviterName ? " to collaborate as " : ""}
        <span className="font-medium text-ink">{invite.role}</span>.
      </p>

      {signedInAsInvitee ? (
        <Button size="lg" className="mt-7 w-full" loading={accepting} onClick={accept}>
          Accept invitation
        </Button>
      ) : session ? (
        <div className="mt-7 flex flex-col gap-3">
          <p className="text-sm text-ink-2">
            You&apos;re signed in as <span className="font-medium text-ink">{session.user.email}</span>. This invitation is for{" "}
            <span className="font-medium text-ink">{invite.email}</span>.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              signOut();
              router.push(`/signin?next=${encodeURIComponent(here)}`);
            }}
          >
            Sign in with {invite.email}
          </Button>
        </div>
      ) : (
        <div className="mt-7 flex flex-col gap-3">
          <Button size="lg" onClick={() => router.push(`/signin?next=${encodeURIComponent(here)}`)}>
            Sign in to accept
          </Button>
          <Button variant="secondary" onClick={() => router.push(`/signup?next=${encodeURIComponent(here)}`)}>
            Create an account with {invite.email}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInvite />
    </Suspense>
  );
}
