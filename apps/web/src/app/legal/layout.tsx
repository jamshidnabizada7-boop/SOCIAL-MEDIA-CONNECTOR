import Link from "next/link";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="font-display text-lg font-bold tracking-tight">
            aria<span className="text-accent">hub</span>
          </Link>
          <nav className="flex gap-4 text-[13px] text-ink-2">
            <Link href="/legal/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-ink">Terms</Link>
            <Link href="/legal/data-deletion" className="hover:text-ink">Data deletion</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <article className="legal space-y-4 text-[15px] leading-relaxed text-ink-2 [&_h1]:font-display [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:text-ink [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_a]:text-accent-ink [&_a]:underline">
          {children}
        </article>
      </main>
    </div>
  );
}
