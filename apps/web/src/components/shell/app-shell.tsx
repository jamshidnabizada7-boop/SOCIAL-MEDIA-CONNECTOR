"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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
  Infinity as InfinityIcon,
  MoreHorizontal,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { useSession, useTheme, useToast } from "@/components/providers";
import { NAV_ITEMS, MOBILE_NAV } from "./nav-config";
import { CommandPalette } from "./command-palette";
import { Avatar, Skeleton } from "@/components/ui/primitives";
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
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-on-accent shadow-sm">
        <InfinityIcon className="size-6" aria-hidden />
      </span>
      {!compact && (
        <span>
          <span className="block font-display text-[22px] font-bold leading-tight tracking-tight">
            Aria Hub
          </span>
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Creator Suite
          </span>
        </span>
      )}
    </span>
  );
}

/* ---------------------------- Workspace switcher --------------------------- */

function WorkspaceSwitcher({ above = false }: { above?: boolean }) {
  useSubscribe(workspaceService);
  const { session, setWorkspace } = useSession();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  if (!session) return null;
  const cached = workspaceService.workspaces();
  const workspaces = cached.length ? cached : [session.workspace];
  const refreshChoices = async () => {
    if (!workspaceService.refreshWorkspaces) return;
    setLoading(true);
    setError("");
    try {
      await workspaceService.refreshWorkspaces();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void refreshChoices();
        }}
        aria-label="Switch workspace"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl border bg-surface px-2.5 py-2 text-left transition-colors hover:border-line-strong"
      >
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold text-white"
          style={{
            background: `linear-gradient(135deg, hsl(162 45% 42%), hsl(190 50% 30%))`,
          }}
        >
          {session.workspace.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight">
            {session.workspace.name}
          </span>
          <span className="block text-[11px] capitalize leading-tight text-ink-3">
            {session.workspace.plan} plan
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 text-ink-3 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="group"
            aria-label="Choose workspace"
            className={cn(
              "pop-in absolute inset-x-0 z-40 max-h-[60dvh] overflow-y-auto rounded-xl border bg-surface p-1.5 shadow-pop",
              above ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
            )}
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Workspaces
            </p>
            {loading && (
              <p role="status" className="px-2.5 py-2 text-xs text-ink-2">
                Refreshing workspaces…
              </p>
            )}
            {error && (
              <div
                role="alert"
                className="m-2 rounded-lg bg-warn-soft p-3 text-xs text-warn-ink"
              >
                {error}
                <button
                  className="mt-1 block min-h-11 font-semibold underline"
                  onClick={() => void refreshChoices()}
                >
                  Retry workspace list
                </button>
              </div>
            )}
            {workspaces.map((w) => (
              <button
                key={w.id}
                aria-pressed={w.id === session.workspace.id}
                onClick={() => {
                  setWorkspace(w.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-surface-2",
                  w.id === session.workspace.id &&
                    "bg-accent-soft text-accent-ink hover:bg-accent-soft",
                )}
              >
                <span
                  className="flex size-6 items-center justify-center rounded-md font-display text-[10px] font-bold text-white"
                  style={{
                    background: `linear-gradient(135deg, hsl(162 45% 42%), hsl(190 50% 30%))`,
                  }}
                >
                  {w.name.slice(0, 1)}
                </span>
                <span className="flex-1 truncate font-medium">{w.name}</span>
                {w.id === session.workspace.id && (
                  <CheckCheck className="size-3.5" aria-hidden />
                )}
              </button>
            ))}
            <div className="mx-1 my-1 border-t" />
            <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Brands
            </p>
            {session.workspace.brands.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-ink-2"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: `hsl(${b.hue} 55% 50%)` }}
                />
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
            href={
              n.postId
                ? `/posts/${n.postId}`
                : n.accountId
                  ? "/accounts"
                  : "/notifications"
            }
            onClick={() => notificationsService.markRead(n.id)}
            className="flex gap-3 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-2"
          >
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                !n.read ? "bg-accent" : "bg-transparent",
              )}
            />
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-[13px] leading-snug",
                  !n.read ? "font-semibold" : "text-ink-2",
                )}
              >
                {n.title}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                {n.body}
              </span>
              <span className="mt-1 block text-[11px] text-ink-3">
                {timeAgo(n.createdAt)}
              </span>
            </span>
          </Link>
        ))}
        {items.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-ink-3">
            You&apos;re all caught up.
          </p>
        )}
      </div>
      <Link
        href="/notifications"
        className="block border-t bg-surface-2 px-4 py-2.5 text-center text-[13px] font-medium text-accent-ink hover:underline"
      >
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
    <nav
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 pb-4"
      aria-label="Main"
    >
      <div>
        <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Workspace
        </p>
        <ul className="flex flex-col gap-0.5">
          {items
            .filter((i) => i.section === "workspace")
            .map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  {item.disabled ? (
                    <span
                      className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-3"
                      title={item.disabledNote}
                    >
                      <item.icon className="size-4.5" />
                      {item.label}
                      <span className="ml-auto rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium">
                        Later
                      </span>
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
                            : "text-ink-2 hover:bg-surface-2 hover:text-ink",
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
        <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Configure
        </p>
        <ul className="flex flex-col gap-0.5">
          {items
            .filter((i) => i.section === "configure")
            .map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      active
                        ? "bg-accent-soft font-semibold text-accent-ink"
                        : "text-ink-2 hover:bg-surface-2 hover:text-ink",
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

function StudioSidebar() {
  const pathname = usePathname();
  const { session } = useSession();
  const primary = [
    "/feed",
    "/explore",
    "/dashboard",
    "/composer",
    "/inbox",
    "/analytics",
    "/settings",
  ];
  const available = NAV_ITEMS.filter(
    (i) => !i.adminOnly || session?.user.isAdmin,
  );
  const link = (item: (typeof NAV_ITEMS)[number]) => {
    const active =
      pathname === item.href ||
      pathname.startsWith(item.href + "/") ||
      (item.href === "/feed" && pathname === "/videos");
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-xl px-4 text-[15px] transition-colors",
          active
            ? "bg-accent font-semibold text-on-accent"
            : "text-ink-2 hover:bg-surface-2 hover:text-ink",
        )}
      >
        <item.icon className="size-5 shrink-0" aria-hidden />
        <span>{item.label}</span>
        {item.href === "/composer" && (
          <Plus className="ml-auto size-4" aria-hidden />
        )}
      </Link>
    );
  };
  return (
    <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto pt-6">
      <div className="space-y-1">
        {primary
          .map((href) => available.find((i) => i.href === href))
          .filter((i): i is (typeof NAV_ITEMS)[number] => !!i)
          .map(link)}
      </div>
      <details className="mt-2">
        <summary className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-4 text-sm text-ink-2 hover:bg-surface-2">
          <MoreHorizontal className="size-5" />
          More tools
          <ChevronDown className="ml-auto size-4" />
        </summary>
        <div className="space-y-1 pt-1">
          {available.filter((i) => !primary.includes(i.href)).map(link)}
        </div>
      </details>
    </nav>
  );
}

function ChannelStatus() {
  useSubscribe(accountsService);
  const { session } = useSession();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    void accountsService
      .listAsync()
      .then(() => {
        if (live) setAvailable(true);
      })
      .catch(() => {
        if (live) setAvailable(false);
      });
    return () => {
      live = false;
    };
  }, [session?.workspace.id]);
  const accounts = available ? accountsService.list() : [];
  const issues = accounts.filter((a) => a.connection !== "healthy").length;
  return (
    <Link href="/accounts" className="block rounded-xl bg-studio-soft p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-2">
        Channels
      </p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-2 rounded-lg bg-surface px-2 py-1">
          <span
            className={cn(
              "size-1.5 rounded-full",
              issues ? "bg-warn" : "bg-accent",
            )}
          />
          {available ? `${accounts.length} connected` : "Check connections"}
        </span>
        <span className="text-ink-2">
          {available
            ? issues
              ? `${issues} to review`
              : "Healthy"
            : "View status"}
        </span>
      </div>
    </Link>
  );
}

function Topbar({
  onOpenPalette,
  onOpenMobileNav,
}: {
  onOpenPalette: () => void;
  onOpenMobileNav: () => void;
}) {
  const { session, signOut } = useSession();
  const { mode, setMode } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const social = ["/feed", "/explore", "/inbox"].includes(pathname);
  const mobileTitle =
    pathname === "/composer" || pathname === "/dashboard"
      ? "Creator Studio"
      : pathname === "/accounts"
        ? "Profile"
        : pathname === "/videos"
          ? "Post Details"
          : null;
  if (!session) return null;

  const themeIcon =
    mode === "dark" ? (
      <Moon className="size-4.5" />
    ) : mode === "light" ? (
      <Sun className="size-4.5" />
    ) : (
      <Monitor className="size-4.5" />
    );

  return (
    <header className="app-topbar sticky top-0 z-40 flex h-16 shrink-0 items-center gap-2 bg-surface/90 px-4 shadow-[0_1px_8px_rgba(0,0,0,.04)] backdrop-blur-xl lg:px-8">
      <button
        onClick={onOpenMobileNav}
        className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>
      <Link
        href="/feed"
        className={cn(
          "lg:hidden",
          (social || mobileTitle) && "hidden sm:block",
        )}
        aria-label="Aria Hub home"
      >
        <Logo compact />
      </Link>
      {mobileTitle && (
        <span className="mr-auto whitespace-nowrap font-display text-sm font-bold lg:hidden">
          {mobileTitle}
        </span>
      )}
      {social && (
        <nav
          aria-label="Social feed"
          className="mr-auto flex items-center gap-4 whitespace-nowrap lg:hidden"
        >
          <Link
            href="/feed"
            className="min-h-11 content-center text-[13px] font-semibold text-accent-ink"
          >
            For You
          </Link>
          <Link
            href="/feed?view=following"
            className="min-h-11 content-center text-[13px] text-ink-2"
          >
            Following
          </Link>
        </nav>
      )}
      <button
        onClick={onOpenPalette}
        className="ml-1 hidden h-10 w-80 items-center gap-2.5 rounded-xl bg-surface-2 px-3 text-sm text-ink-3 transition-colors hover:text-ink-2 lg:flex"
      >
        <Search className="size-4" />
        Search media, posts, tags…
        <kbd className="ml-auto rounded-md border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium">
          ⌘K
        </kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <nav
          aria-label="Studio shortcuts"
          className="mr-5 hidden items-center gap-5 text-[13px] text-ink-2 xl:flex"
        >
          <Link href="/content" className="hover:text-accent-ink">
            Content Library
          </Link>
          <Link href="/calendar" className="hover:text-accent-ink">
            Calendar
          </Link>
          <Link href="/posts" className="hover:text-accent-ink">
            Posts
          </Link>
        </nav>
        <button
          onClick={onOpenPalette}
          aria-label="Search or jump to a page"
          className="grid size-10 place-items-center rounded-xl hover:bg-surface-2 lg:hidden"
        >
          <Search className="size-5" />
        </button>
        <NotificationsBell />
        <DropdownMenu
          width="w-44"
          trigger={({ toggle }) => (
            <button
              onClick={toggle}
              aria-label="Toggle color theme"
              className="hidden rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink lg:block"
            >
              {themeIcon}
            </button>
          )}
          items={[
            {
              label: "Light",
              icon: <Sun className="size-4" />,
              onSelect: () => setMode("light"),
            },
            {
              label: "Dark",
              icon: <Moon className="size-4" />,
              onSelect: () => setMode("dark"),
            },
            {
              label: "System",
              icon: <Monitor className="size-4" />,
              onSelect: () => setMode("system"),
            },
          ]}
        />
        <DropdownMenu
          width="w-56"
          trigger={({ toggle }) => (
            <button
              onClick={toggle}
              className="ml-1 flex items-center gap-2 rounded-full p-0.5 pr-2 transition-colors hover:bg-surface-2"
              aria-label="Account menu"
            >
              <Avatar
                name={session.user.name}
                hue={session.user.avatarHue}
                size="sm"
              />
              <span className="hidden text-[13px] font-medium lg:block">
                {session.user.name.split(" ")[0]}
              </span>
              <ChevronDown className="hidden size-3 text-ink-3 lg:block" />
            </button>
          )}
          items={[
            {
              label: "Profile",
              icon: <UserRound className="size-4" />,
              onSelect: () => router.push("/settings?tab=profile"),
            },
            {
              label: "Workspace settings",
              icon: <SettingsIcon className="size-4" />,
              onSelect: () => router.push("/settings"),
            },
            {
              separatorBefore: true,
              label: "Light theme",
              icon: <Sun className="size-4" />,
              onSelect: () => setMode("light"),
            },
            {
              label: "Dark theme",
              icon: <Moon className="size-4" />,
              onSelect: () => setMode("dark"),
            },
            {
              separatorBefore: true,
              label: "Sign out",
              icon: <LogOut className="size-4" />,
              onSelect: () => {
                signOut();
                router.push("/");
              },
            },
          ]}
        />
      </div>
    </header>
  );
}

/* -------------------------------- Mobile nav ------------------------------- */

function MobileNavDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { session, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  const openedPath = useRef(pathname);

  useEffect(() => {
    if (!open) return;
    if (openedPath.current !== pathname) onClose();
  }, [open, pathname, onClose]);

  useEffect(() => {
    if (!open) {
      openedPath.current = pathname;
      return;
    }
    openedPath.current = pathname;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => {
      if (desktop.matches) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0);
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onResize);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
    // Path changes are handled by the separate navigation effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  if (!session || !open) return null;
  return (
    <div className="fixed inset-0 z-[80] lg:hidden">
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] dark:bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Mobile navigation"
        className="pop-in absolute inset-y-0 left-0 flex w-72 max-w-[calc(100vw-2rem)] flex-col border-r bg-surface shadow-pop"
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Logo />
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-lg p-2 text-ink-3 hover:bg-surface-2"
          >
            <X className="size-4.5" />
          </button>
        </div>
        <div className="p-3">
          <WorkspaceSwitcher />
        </div>
        <SidebarContent onNavigate={onClose} />
        <div className="border-t p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <Avatar
              name={session.user.name}
              hue={session.user.avatarHue}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">
                {session.user.name}
              </p>
              <p className="truncate text-[12px] text-ink-3">
                {session.user.email}
              </p>
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
  const closeMobileNav = useCallback(() => setMobileNav(false), []);
  const toast = useToast();

  useEffect(() => {
    if (!ready) return; // wait for the stored session to load before judging auth
    if (!session) {
      router.replace("/signin");
      return;
    }
    postsService.resumeInFlight();
    if (DATA_MODE === "api") {
      void workspaceService.refreshWorkspaces?.().catch((error) => {
        toast({
          title: "Workspace list could not refresh",
          description: (error as Error).message,
          variant: "error",
        });
      });
    }
  }, [ready, session, router, toast]);

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
      toast({
        title: "Press ⌘K to jump anywhere",
        description: "The command palette searches posts and pages.",
        variant: "info",
        duration: 5200,
      });
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
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-surface p-4 shadow-[1px_0_8px_rgba(0,0,0,.03)] lg:flex 2xl:w-72">
        <div className="flex h-16 items-center px-2">
          <Link href="/feed" aria-label="Aria Hub home">
            <Logo />
          </Link>
        </div>
        <StudioSidebar />
        <div className="space-y-3 pt-4">
          <ChannelStatus key={session.workspace.id} />
          <WorkspaceSwitcher above />
          <Link
            href="/accounts"
            className="flex min-h-14 items-center gap-3 rounded-xl bg-studio-soft p-3"
          >
            <Avatar
              name={session.user.name}
              hue={session.user.avatarHue}
              size="sm"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {session.user.name}
              </span>
              <span className="block truncate text-xs text-ink-2">
                Profile & channels
              </span>
            </span>
            <ChevronDown className="ml-auto size-4 shrink-0 text-ink-3" />
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenMobileNav={() => setMobileNav(true)}
        />
        <EmailVerificationBanner />
        <main
          key={session.workspace.id}
          className="min-w-0 flex-1 pb-[calc(80px+env(safe-area-inset-bottom,0px))] lg:pb-0"
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t bg-surface/95 backdrop-blur-xl lg:hidden"
        aria-label="Primary mobile"
      >
        {MOBILE_NAV.map((item) => (
          <MobileTab
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
          />
        ))}
      </nav>

      <MobileNavDrawer open={mobileNav} onClose={closeMobileNav} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}

function MobileTab({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  if (href === "/composer") {
    return (
      <Link
        href={href}
        className="flex flex-1 items-center justify-center"
        aria-label="Create post"
      >
        <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-md shadow-accent/25">
          <Plus className="size-6" />
        </span>
      </Link>
    );
  }
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
        active ? "text-accent-ink" : "text-ink-3",
      )}
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
  if (DATA_MODE !== "api" || !session || session.user.emailVerified !== false)
    return null;
  const resend = async () => {
    setSending(true);
    try {
      const { sessionApi } = await import("@/lib/api/session");
      await sessionApi.resendVerification();
      toast({
        title: "Confirmation email sent",
        description: `Check ${session.user.email}.`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Couldn't send the email",
        description: (err as Error).message,
        variant: "error",
      });
    } finally {
      setSending(false);
    }
  };
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-warn-soft px-4 py-2 text-[13px] text-warn-ink sm:px-6"
    >
      <span>
        Confirm your email address ({session.user.email}) to keep your account
        secure.
      </span>
      <button
        type="button"
        onClick={resend}
        disabled={sending}
        className="font-semibold underline-offset-2 hover:underline disabled:opacity-60"
      >
        {sending ? "Sending…" : "Resend link"}
      </button>
    </div>
  );
}
