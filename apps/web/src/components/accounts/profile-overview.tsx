"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  Bookmark,
  CalendarClock,
  Clapperboard,
  Grid3X3,
} from "lucide-react";
import type { SocialAccount, Post } from "@/lib/types";
import { useSession } from "@/components/providers";
import { Avatar } from "@/components/ui/primitives";
import { postsService } from "@/lib/services/posts";

export function ProfileOverview({ accounts }: { accounts: SocialAccount[] }) {
  const { session } = useSession();
  const [posts, setPosts] = useState<Post[] | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      if (live) setPosts(postsService.list());
    };
    const unsubscribe = postsService.subscribe(read);
    void postsService
      .listAsync()
      .then(read)
      .catch(() => {});
    return () => {
      live = false;
      unsubscribe();
    };
  }, [session?.workspace.id]);
  if (!session) return null;
  const healthy = accounts.filter((a) => a.connection === "healthy").length;
  return (
    <section
      aria-label="Your creator profile"
      className="rounded-2xl bg-surface p-4 shadow-[0_2px_12px_rgba(20,27,43,.04)] lg:p-6"
    >
      <div className="flex items-start justify-between">
        <div className="relative rounded-full bg-accent-soft p-2">
          <Avatar
            name={session.user.name}
            hue={session.user.avatarHue}
            size="lg"
          />
          {session.user.emailVerified && (
            <BadgeCheck
              className="absolute -bottom-1 -right-1 size-6 rounded-full bg-surface p-0.5 text-accent-ink"
              aria-label="Email verified"
            />
          )}
        </div>
        <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold capitalize text-accent-ink">
          {session.workspace.plan} workspace
        </span>
      </div>
      <h2 className="mt-5 font-display text-[22px] font-bold tracking-tight">
        {session.user.name}
      </h2>
      <p className="mt-1 break-words text-sm text-ink-2">
        {session.user.email}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        Creating with{" "}
        <span className="font-semibold text-ink">{session.workspace.name}</span>
        . Your channels, content and conversations, together.
      </p>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[
          [accounts.length, "Channels"],
          [healthy, "Healthy"],
          [
            posts
              ? posts.filter(
                  (p) =>
                    p.state === "published" ||
                    p.state === "partially_published",
                ).length
              : "—",
            "Published",
          ],
        ].map(([value, label]) => (
          <div
            key={String(label)}
            className="rounded-xl bg-surface-2 p-3 text-center"
          >
            <p className="font-display text-xl font-bold">{value}</p>
            <p className="mt-1 text-[11px] text-ink-2">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link
          href="/settings?tab=profile"
          className="flex min-h-12 items-center justify-center rounded-xl bg-surface-2 text-sm font-semibold hover:bg-studio-soft"
        >
          Edit Profile
        </Link>
        <Link
          href="/dashboard"
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          <Clapperboard className="size-4" />
          Studio
          <ArrowUpRight className="size-4" />
        </Link>
      </div>
      <nav
        aria-label="Your content"
        className="mt-5 grid grid-cols-3 gap-1 border-t pt-3 text-xs font-medium text-ink-2"
      >
        <Link
          href="/posts?tab=published"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg hover:bg-surface-2"
        >
          <Grid3X3 className="size-4" />
          Published
        </Link>
        <Link
          href="/posts?tab=scheduled"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg hover:bg-surface-2"
        >
          <CalendarClock className="size-4" />
          Scheduled
        </Link>
        <Link
          href="/feed?view=saved"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg hover:bg-surface-2"
        >
          <Bookmark className="size-4" />
          Saved
        </Link>
      </nav>
    </section>
  );
}
