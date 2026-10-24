"use client";

import { useEffect, useReducer } from "react";

/** Re-renders the component whenever the service emits a change. */
export function useSubscribe(target: { subscribe(fn: () => void): () => void }): void {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => target.subscribe(force), [target, force]);
}

export type Subscribable = { subscribe(fn: () => void): () => void };

/** Combines several service subscriptions into one unsubscribe. */
export function combineSubscriptions(...targets: Subscribable[]): () => void {
  const unsubs = targets.map((t) => t.subscribe(() => {}));
  return () => unsubs.forEach((u) => u());
}

/**
 * Loads service data once (with simulated latency) and then keeps the local
 * state mirrored to the service on every emit, so mutations made anywhere in
 * the app (or by the publishing engine) are reflected live.
 */
export function useServiceData<T>(
  initial: () => Promise<T>,
  current: () => T,
  services: Subscribable[]
): T | null {
  const [state, setState] = useReducer((_: T | null, next: T) => next, null);
  const read = () => setState(current());
  useEffect(() => {
    let alive = true;
    initial().then((v) => {
      if (alive) setState(v);
    });
    const unsubs = services.map((s) => s.subscribe(read));
    return () => {
      alive = false;
      unsubs.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}
