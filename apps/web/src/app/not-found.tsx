import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper px-6 text-center">
      <p className="font-display text-[64px] font-extrabold leading-none tracking-tight text-accent">404</p>
      <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">This page took a different route</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-2">
        The link may be old, or the post was deleted. Everything else is right where you left it.
      </p>
      <div className="mt-6 flex gap-2.5">
        <Link href="/dashboard" className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover">
          Go home
        </Link>
        <Link href="/posts" className="rounded-lg border bg-surface px-4 py-2.5 text-sm font-medium transition-colors hover:bg-surface-2">
          Browse posts
        </Link>
      </div>
    </div>
  );
}
