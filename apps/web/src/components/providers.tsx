"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";
import { cn, uid } from "@/lib/utils";
import type { User, Workspace } from "@/lib/types";
import { CURRENT_USER_ID, USERS } from "@/lib/mock/data";
import { workspaceService } from "@/lib/services/workspace";
import { DATA_MODE } from "@/lib/api/client";
import { sessionApi, type ApiWorkspaceSummary } from "@/lib/api/session";

/* --------------------------------- Theme ---------------------------------- */

type ThemeMode = "light" | "dark" | "system";

const ThemeContext = createContext<{
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
}>({ mode: "system", setMode: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

function applyTheme(mode: ThemeMode) {
  const dark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/* --------------------------------- Toasts --------------------------------- */

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: "success" | "error" | "info" | "warning";
  duration?: number;
}

const ToastContext = createContext<{
  toast: (t: Omit<Toast, "id">) => void;
}>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext).toast;
}

/* --------------------------------- Session -------------------------------- */

export interface Session {
  user: User;
  workspace: Workspace;
  brandId: string | null;
}

const SessionContext = createContext<{
  session: Session | null;
  /** True once the stored session has been read/restored. */
  ready: boolean;
  signIn: (email?: string, password?: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => void;
  setWorkspace: (id: string) => void;
  setBrand: (id: string | null) => void;
  refresh: () => Promise<void>;
}>({
  session: null,
  ready: false,
  signIn: async () => {},
  signUp: async () => {},
  signOut: () => {},
  setWorkspace: () => {},
  setBrand: () => {},
  refresh: async () => {},
});

export function useSession() {
  return useContext(SessionContext);
}

/* --------------------------------- Provider ------------------------------- */

export function AppProviders({ children }: { children: ReactNode }) {
  // Theme
  const [mode, setModeState] = useState<ThemeMode>("system");
  useEffect(() => {
    const stored =
      (localStorage.getItem("aria-theme") as ThemeMode) || "system";
    setModeState(stored);
    applyTheme(stored);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => mode === "system" && applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);
  const setMode = useCallback((m: ThemeMode) => {
    localStorage.setItem("aria-theme", m);
    setModeState(m);
    applyTheme(m);
  }, []);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, number>>(new Map());
  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = uid("toast");
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, t.duration ?? 4200);
    timers.current.set(id, timer);
  }, []);
  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
  }, []);

  // Session — dual mode. API mode: cookie session via /v1/auth/*.
  // Mock mode: the localStorage-backed demo workspace.
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  const buildApiSession = useCallback(async (): Promise<Session | null> => {
    try {
      let me = await sessionApi.me();
      if (me.workspaces.length === 0) {
        // First sign-in (or the last workspace was deleted): every account
        // needs a home. Onboarding renames it.
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        await sessionApi.createWorkspace(
          `${me.user.name.split(" ")[0] || "My"}'s workspace`,
          tz,
        );
        me = await sessionApi.me();
      }
      const wsSummaries: ApiWorkspaceSummary[] = me.workspaces;
      if (wsSummaries.length === 0) return null;
      const preferred = localStorage.getItem("aria-workspace");
      const summary =
        wsSummaries.find((w) => w.workspaceId === preferred) ?? wsSummaries[0];
      // The authenticated membership list validates any persisted workspace choice.
      localStorage.setItem("aria-workspace", summary.workspaceId);
      const { apiWorkspaceService } = await import("@/lib/services/backend");
      const full =
        (await apiWorkspaceService.getDetail(summary.workspaceId)) ?? null;
      const workspace: Workspace = full ?? {
        id: summary.workspaceId,
        name: summary.name,
        timezone: summary.timezone,
        locale: summary.locale,
        plan: summary.planId as Workspace["plan"],
        brands: [],
        createdAt: new Date().toISOString(),
      };
      const user: User = {
        id: me.user.id,
        name: me.user.name,
        email: me.user.email,
        avatarHue: me.user.avatarHue ?? 200,
        role:
          (wsSummaries.find((w) => w.workspaceId === workspace.id)
            ?.role as User["role"]) ?? "owner",
        isAdmin: me.user.isPlatformAdmin,
        emailVerified: me.user.emailVerified ?? true,
        lastActiveAt: new Date().toISOString(),
        status: "active",
      };
      const brandId =
        localStorage.getItem("aria-brand") ?? workspace.brands[0]?.id ?? null;
      return { user, workspace, brandId };
    } catch {
      return null;
    }
  }, []);

  const readSession = useCallback((): Session | null => {
    try {
      const raw = localStorage.getItem("aria-session");
      if (!raw) return null;
      const email = JSON.parse(raw) as string;
      const user = USERS.find((u) => u.email === email) ?? USERS[0];
      const wsId = localStorage.getItem("aria-workspace") ?? "ws_aria";
      const brandId = localStorage.getItem("aria-brand");
      const workspace =
        workspaceService.get(wsId) ?? workspaceService.workspaces()[0];
      if (!workspace) return null;
      return {
        user,
        workspace,
        brandId: brandId ?? workspace.brands[0]?.id ?? null,
      };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    if (DATA_MODE === "api") {
      buildApiSession().then((s) => {
        if (!alive) return;
        setSession(s);
        setReady(true);
      });
    } else {
      setSession(readSession());
      setReady(true);
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    if (DATA_MODE === "api") {
      setSession(await buildApiSession());
    } else {
      setSession(readSession());
    }
  }, [buildApiSession, readSession]);

  const signIn = useCallback(
    async (email?: string, password?: string) => {
      if (DATA_MODE === "api") {
        await sessionApi.login(email ?? "", password ?? "");
        await refresh();
        return;
      }
      const mail = email ?? USERS.find((u) => u.id === CURRENT_USER_ID)!.email;
      localStorage.setItem("aria-session", JSON.stringify(mail));
      setSession(readSession());
    },
    [readSession, refresh],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      if (DATA_MODE === "api") {
        await sessionApi.register(name, email, password);
        await refresh();
        return;
      }
      await signIn(email, password);
    },
    [signIn, refresh],
  );

  const signOut = useCallback(() => {
    if (DATA_MODE === "api") {
      void sessionApi.logout();
    }
    localStorage.removeItem("aria-session");
    setSession(null);
  }, []);

  const setWorkspace = useCallback(
    (id: string) => {
      localStorage.setItem("aria-workspace", id);
      localStorage.removeItem("aria-brand");
      if (DATA_MODE === "api") {
        // Recreate service caches and cancel old-page requests across workspaces.
        window.location.reload();
        return;
      }
      void refresh();
    },
    [refresh],
  );

  const setBrand = useCallback(
    (id: string | null) => {
      if (id) localStorage.setItem("aria-brand", id);
      else localStorage.removeItem("aria-brand");
      void refresh();
    },
    [refresh],
  );

  return (
    <ThemeContext.Provider value={{ mode, setMode }}>
      <ToastContext.Provider value={{ toast }}>
        <SessionContext.Provider
          value={{
            session,
            ready,
            signIn,
            signUp,
            signOut,
            setWorkspace,
            setBrand,
            refresh,
          }}
        >
          {children}
          {/* Toast viewport */}
          <div
            aria-live="polite"
            className="fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2"
          >
            {toasts.map((t) => (
              <div
                key={t.id}
                role="status"
                className={cn(
                  "pop-in flex items-start gap-3 rounded-xl border bg-surface p-3.5 shadow-pop",
                  t.variant === "success" && "border-success/30",
                  t.variant === "error" && "border-danger/30",
                  t.variant === "warning" && "border-warn/30",
                )}
              >
                {t.variant === "success" ? (
                  <CheckCircle2
                    className="mt-0.5 size-4.5 shrink-0 text-success"
                    aria-hidden
                  />
                ) : t.variant === "error" ? (
                  <XCircle
                    className="mt-0.5 size-4.5 shrink-0 text-danger"
                    aria-hidden
                  />
                ) : t.variant === "warning" ? (
                  <TriangleAlert
                    className="mt-0.5 size-4.5 shrink-0 text-warn"
                    aria-hidden
                  />
                ) : (
                  <Info
                    className="mt-0.5 size-4.5 shrink-0 text-info"
                    aria-hidden
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">{t.title}</p>
                  {t.description && (
                    <p className="mt-0.5 text-sm leading-snug text-ink-2">
                      {t.description}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
                  aria-label="Dismiss notification"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </SessionContext.Provider>
      </ToastContext.Provider>
    </ThemeContext.Provider>
  );
}
