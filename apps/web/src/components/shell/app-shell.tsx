"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  CheckCheck,
  ChevronDown,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { useSession, useTheme, useToast } from "@/components/providers";
import { NAV_ITEMS, MOBILE_NAV } from "./nav-config";
import { CommandPalette } from "./command-palette";
import { Avatar, Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { DropdownMenu, Popover } from "@/components/ui/dialog";
import { notificationsService } from "@/lib/services/notifications";
import { useSubscribe } from "@/lib/services/hooks";
import { workspaceService } from "@/lib/services/workspace";
import { accountsService } from "@/lib/services/accounts";
import { postsService } from "@/lib/services/posts";
import { DATA_MODE } from "@/lib/api/client";

/* ---------------------------------- Logo ---------------------------------- */

function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden>
        <rect x="1" y="1" width="22" height="22" rx="6.5" className="fill-accent" />
        <circle cx="8.2" cy="8.2" r="2.1" fill="white" />
        <circle cx="16" cy="8.6" r="1.55" fill="white" opacity="0.85" />
        <circle cx="8.6" cy="16" r="1.55" fill="white" opacity="0.85" />
        <circle cx="16" cy="16" r="2.1" fill="white" opacity="0.7" />
        <path d="M9.7 9.7l4.6 4.7M15.4 10.4l-5.3 4" stroke="white" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
      </svg>
      {!compact && (
        <span className="font-display text-[17px] font-bold tracking-tight">
          aria<span className="text-accent">hub</span>
        </span>
      )}
    </span>
  );
}

/* ---------------------------- Workspace switcher --------------------------- */

function WorkspaceSwitcher() {
  const { session, setWorkspace } = useSession();
  const [open, setOpen] = useState(false);
  if (!session) return null;
  const workspaces = workspaceService.workspaces();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl border bg-surface px-2.5 py-2 text-left transition-colors hover:border-line-strong"
      >
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold text-white"
          style={{ background: `linear-gradient(135deg, hsl(162 45% 42%), hsl(190 50% 30%))` }}
        >
          {session.workspace.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight">{session.workspace.name}</span>
          <span className="block text-[11px] capitalize leading-tight text-ink-3">{session.workspace.plan} plan</span>
        </span>
        <ChevronDown className={cn("size-3.5 text-ink-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div className="pop-in absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl border bg-surface p-1.5 shadow-pop">
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Workspaces</p>
            {workspaces.map((w) => (
              <button
                key={w.id}
                onClick={() => {
                  setWorkspace(w.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-surface-2",
                  w.id === session.workspace.id && "bg-accent-soft text-accent-ink hover:bg-accent-soft"
                )}
              >
                <span className="flex size-6 items-center justify-center rounded-md font-display text-[10px] font-bold text-white"
                  style={{ background: `linear-gradient(135deg, hsl(162 45% 42%), hsl(190 50% 30%))` }}>
                  {w.name.slice(0, 1)}
                </span>
                <span className="flex-1 truncate font-medium">{w.name}</span>
                {w.id === session.workspace.id && <CheckCheck className="size-3.5" aria-hidden />}
              </button>
            ))}
            <div className="mx-1 my-1 border-t" />
            <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Brands</p>
            {session.workspace.brands.map((b) => (
              <div key={b.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-ink-2">
                <span className="size-2 rounded-full" style={{ backgroundColor: `hsl(${b.hue} 55% 50%)` }} />
                {b.name}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------- Notifications bell --------------------------- */

function NotificationsBell() {
  useSubscribe(notificationsService);
  const items = notificationsService.list();
  const unread = items.filter((n) => !n.read).length;
  return (
    <Popover
      width="w-[360px]"
      trigger={({ toggle }) => (
        <button
          onClick={toggle}
          aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
          className="relative rounded-lg p-2 text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Bell className="size-4.5" />
          {unread > 0 && (
            <span className="tnum absolute -right-0.5 -top-0.5 flex min-w-4.5 items-center justify-center rounded-full bg-danger px-1 py-px text-[10px] font-bold text-white">
              {unread}
            </span>
          )}
        </button>
      )}
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-semibold">Notifications</p>
        <button
          onClick={() => notificationsService.markAllRead()}
          className="text-[12px] font-medium text-accent-ink hover:underline"
        >
          Mark all read
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {items.slice(0, 6).map((n) => (
          <Link
            key={n.id}
            href={n.postId ? `/posts/${n.postId}` : n.accountId ? "/accounts" : "/notifications"}
            onClick={() => notificationsService.markRead(n.id)}
            className="flex gap-3 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-2"
          >
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                !n.read ? "bg-accent" : "bg-transparent"
              )}
            />
            <span className="min-w-0">
              <span className={cn("block text-[13px] leading-snug", !n.read ? "font-semibold" : "text-ink-2")}>{n.title}</span>
              <span className="mt-0.5 block truncate text-[12px] text-ink-3">{n.body}</span>
              <span className="mt-1 block text-[11px] text-ink-3">{timeAgo(n.createdAt)}</span>
            </span>
          </Link>
        ))}
        {items.length === 0 && <p className="px-4 py-8 text-center text-sm text-ink-3">You&apos;re all caught up.</p>}
      </div>
      <Link href="/notifications" className="block border-t bg-surface-2 px-4 py-2.5 text-center text-[13px] font-medium text-accent-ink hover:underline">
        View all notifications
      </Link>
    </Popover>
  );
}

/* --------------------------------- Sidebar --------------------------------- */

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { session } = useSession();
  if (!session) return null;
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || session.user.isAdmin);

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 pb-4" aria-label="Main">
      <div>
        <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Workspace</p>
        <ul className="flex flex-col gap-0.5">
          {items
            .filter((i) => i.section === "workspace")
            .map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  {item.disabled ? (
                    <span
                      className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-3"
                      title={item.disabledNote}
                    >
                      <item.icon className="size-4.5" />
                      {item.label}
                      <span className="ml-auto rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium">Later</span>
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                        active
                          ? "bg-accent-soft font-semibold text-accent-ink"
                          : item.accent
                            ? "font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
                            : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                      )}
                    >
                      <item.icon className="size-4.5" />
                      {item.label}
                    </Link>
                  )}
                </li>
              );
            })}
        </ul>
      </div>
      <div>
        <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Configure</p>
        <ul className="flex flex-col gap-0.5">
          {items
            .filter((i) => i.section === "configure")
            .map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      active ? "bg-accent-soft font-semibold text-accent-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                    )}
                  >
                    <item.icon className="size-4.5" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
        </ul>
      </div>
    </nav>
  );
}

/* --------------------------------- Topbar ---------------------------------- */

function Topbar({ onOpenPalette, onOpenMobileNav }: { onOpenPalette: () => void; onOpenMobileNav: () => void }) {
  const { session, signOut } = useSession();
  const { mode, setMode } = useTheme();
  const router = useRouter();
  if (!session) return null;

  const themeIcon = mode === "dark" ? <Moon className="size-4.5" /> : mode === "light" ? <Sun className="size-4.5" /> : <Monitor className="size-4.5" />;

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-paper/85 px-4 backdrop-blur-md lg:px-6">
      <button
        onClick={onOpenMobileNav}
        className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>
      <Link href="/dashboard" className="lg:hidden" aria-label="Aria Hub home">
        <Logo compact />
      </Link>
      <button
        onClick={onOpenPalette}
        className="ml-1 hidden h-9 w-72 items-center gap-2.5 rounded-lg border bg-surface px-3 text-sm text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2 md:flex"
      >
        <Search className="size-4" />
        Search or jump to…
        <kbd className="ml-auto rounded-md border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium">⌘K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <Button size="sm" className="mr-1 hidden sm:inline-flex" onClick={() => router.push("/composer")}>
          <Plus className="size-4" />
          Create post
        </Button>
        <NotificationsBell />
        <DropdownMenu
          width="w-44"
          trigger={({ toggle }) => (
            <button onClick={toggle} aria-label="Toggle color theme" className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink">
              {themeIcon}
            </button>
          )}
          items={[
            { label: "Light", icon: <Sun className="size-4" />, onSelect: () => setMode("light") },
            { label: "Dark", icon: <Moon className="size-4" />, onSelect: () => setMode("dark") },
            { label: "System", icon: <Monitor className="size-4" />, onSelect: () => setMode("system") },
          ]}
        />
        <DropdownMenu
          width="w-56"
          trigger={({ toggle }) => (
            <button onClick={toggle} className="ml-1 flex items-center gap-2 rounded-full p-0.5 pr-2 transition-colors hover:bg-surface-2" aria-label="Account menu">
              <Avatar name={session.user.name} hue={session.user.avatarHue} size="sm" />
              <span className="hidden text-[13px] font-medium lg:block">{session.user.name.split(" ")[0]}</span>
              <ChevronDown className="hidden size-3 text-ink-3 lg:block" />
            </button>
          )}
          items={[
            { label: "Profile", icon: <UserRound className="size-4" />, onSelect: () => router.push("/settings?tab=profile") },
            { label: "Workspace settings", icon: <SettingsIcon className="size-4" />, onSelect: () => router.push("/settings") },
            { separatorBefore: true, label: "Sign out", icon: <LogOut className="size-4" />, onSelect: () => { signOut(); router.push("/"); } },
          ]}
        />
      </div>
    </header>
  );
}

/* -------------------------------- Mobile nav ------------------------------- */

function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, signOut } = useSession();
  const router = useRouter();
  if (!session) return null;
  return (
    <div className="fixed inset-0 z-[80] lg:hidden">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] dark:bg-black/60" onClick={onClose} aria-hidden />
      <div className="pop-in absolute inset-y-0 left-0 flex w-72 flex-col border-r bg-surface shadow-pop">
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Logo />
          <button onClick={onClose} aria-label="Close navigation" className="rounded-lg p-2 text-ink-3 hover:bg-surface-2">
            <X className="size-4.5" />
          </button>
        </div>
        <div className="p-3">
          <WorkspaceSwitcher />
        </div>
        <SidebarContent onNavigate={onClose} />
        <div className="border-t p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <Avatar name={session.user.name} hue={session.user.avatarHue} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{session.user.name}</p>
              <p className="truncate text-[12px] text-ink-3">{session.user.email}</p>
            </div>
            <button
              onClick={() => {
                signOut();
                router.push("/");
              }}
              aria-label="Sign out"
              className="rounded-lg p-2 text-ink-3 hover:bg-surface-2 hover:text-danger"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- AppShell -------------------------------- */

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, ready } = useSession();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!ready) return; // wait for the stored session to load before judging auth
    if (!session) {
      router.replace("/signin");
      return;
    }
    postsService.resumeInFlight();
    if (DATA_MODE === "api") {
      void workspaceService.refreshWorkspaces?.();
    }
  }, [ready, session, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // One-time tour hint
  useEffect(() => {
    const t = window.setTimeout(() => {
      toast({ title: "Press ⌘K to jump anywhere", description: "The command palette searches posts and pages.", variant: "info", duration: 5200 });
    }, 1600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready || !session) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper">
        <div className="w-full max-w-md space-y-4 px-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh bg-paper">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-surface lg:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Link href="/dashboard" aria-label="Aria Hub home">
            <Logo />
          </Link>
        </div>
        <div className="p-3">
          <WorkspaceSwitcher />
        </div>
        <SidebarContent />
        <div className="border-t p-3">
          <Link
            href="/accounts?connect=1"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Plus className="size-4.5" />
            Connect account
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenPalette={() => setPaletteOpen(true)} onOpenMobileNav={() => setMobileNav(true)} />
        <EmailVerificationBanner />
        <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t bg-surface/95 backdrop-blur-md lg:hidden" aria-label="Primary mobile">
        {MOBILE_NAV.map((item) => (
          <MobileTab key={item.href} href={item.href} label={item.label} icon={item.icon} />
        ))}
      </nav>

      <MobileNavDrawer open={mobileNav} onClose={() => setMobileNav(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

function MobileTab({ href, label, icon: Icon }: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  if (href === "/composer") {
    return (
      <Link href={href} className="flex flex-1 items-center justify-center" aria-label="Create post">
        <span className="flex size-11 items-center justify-center rounded-full bg-accent text-on-accent shadow-md shadow-accent/30">
          <Icon className="size-5" />
        </span>
      </Link>
    );
  }
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium", active ? "text-accent-ink" : "text-ink-3")}
    >
      <Icon className="size-5" />
      {label}
    </Link>
  );
}

/** API mode: nudges unverified accounts to confirm their email, with a resend action. */
function EmailVerificationBanner() {
  const { session } = useSession();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  if (DATA_MODE !== "api" || !session || session.user.emailVerified !== false) return null;
  const resend = async () => {
    setSending(true);
    try {
      const { sessionApi } = await import("@/lib/api/session");
      await sessionApi.resendVerification();
      toast({ title: "Confirmation email sent", description: `Check ${session.user.email}.`, variant: "success" });
    } catch (err) {
      toast({ title: "Couldn't send the email", description: (err as Error).message, variant: "error" });
    } finally {
      setSending(false);
    }
  };
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-warn-soft px-4 py-2 text-[13px] text-warn-ink sm:px-6">
      <span>Confirm your email address ({session.user.email}) to keep your account secure.</span>
      <button type="button" onClick={resend} disabled={sending} className="font-semibold underline-offset-2 hover:underline disabled:opacity-60">
        {sending ? "Sending…" : "Resend link"}
      </button>
    </div>
  );
}
