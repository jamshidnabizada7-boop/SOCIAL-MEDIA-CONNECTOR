export type Unsubscribe = () => void;

/** Tiny observable used by mock services so the UI can live-update. */
export class Notifier {
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(): void {
    this.listeners.forEach((fn) => fn());
  }
}

export const LATENCY = {
  fast: 250,
  normal: 450,
  slow: 700,
};

export function latency(kind: keyof typeof LATENCY = "normal"): Promise<void> {
  const ms = LATENCY[kind] + Math.random() * 150;
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------------------ */
/* Mock-store persistence                                              */
/*                                                                     */
/* The UI phase keeps all data client-side; persisting it to           */
/* localStorage makes the prototype survive reloads so reviewers       */
/* don't lose their work. The real backend replaces this wholesale.    */
/* ------------------------------------------------------------------ */

export function loadPersisted<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`aria-mock:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

const saveTimers = new Map<string, number>();

export function persistDebounced(key: string, get: () => unknown, ms = 350): void {
  if (typeof window === "undefined") return;
  const existing = saveTimers.get(key);
  if (existing !== undefined) window.clearTimeout(existing);
  saveTimers.set(
    key,
    window.setTimeout(() => {
      saveTimers.delete(key);
      try {
        localStorage.setItem(`aria-mock:${key}`, JSON.stringify(get()));
      } catch {
        // storage full/blocked — the prototype keeps working in memory
      }
    }, ms)
  );
}

export const MOCK_STORE_KEYS = [
  "accounts",
  "posts",
  "media",
  "notifications",
  "queue",
  "workspace",
  "admin",
] as const;

export function resetMockStore(): void {
  if (typeof window === "undefined") return;
  for (const key of MOCK_STORE_KEYS) localStorage.removeItem(`aria-mock:${key}`);
}
