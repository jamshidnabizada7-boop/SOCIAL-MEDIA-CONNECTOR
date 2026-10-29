import type { FeedPreferences, UniversalFeedItem } from "./feed.js";

function hash(text: string): number {
  let n = 2166136261;
  for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
export const feedItemKey = (i: Pick<UniversalFeedItem, "provider" | "providerPostId">) =>
  `${i.provider}:${i.providerPostId}`;
/** Deterministic weighted shuffle followed by provider/creator interleaving. Freeze the result per session. */
export function mixFeed(
  items: UniversalFeedItem[],
  seed: string,
  prefs: FeedPreferences,
  now: number,
  recentIds: string[] = [],
): UniversalFeedItem[] {
  const seen = new Set<string>();
  const pool = items
    .filter((i) => {
      const key = feedItemKey(i);
      if (
        seen.has(key) ||
        i.availability === "unavailable" ||
        prefs.mutedSourceIds.includes(i.sourceId) ||
        (i.sensitive && !prefs.showSensitive)
      )
        return false;
      seen.add(key);
      return true;
    })
    .map((item) => {
      const ageDays = item.publishedAt
        ? Math.max(0, (now - new Date(item.publishedAt).getTime()) / 86400000)
        : 30;
      let weight = 0.6 + 1 / (1 + ageDays / 4);
      if (prefs.favoriteProviders.includes(item.provider)) weight *= 1.6;
      if (item.topics.some((t) => prefs.topics.includes(t))) weight *= 1.5;
      if (prefs.reducedSourceIds.includes(item.sourceId)) weight *= 0.25;
      if (recentIds.includes(item.id)) weight *= 0.15;
      const uniform = (hash(`${seed}:${feedItemKey(item)}`) + 1) / 4294967297;
      return { item, score: -Math.log(uniform) / weight };
    })
    .sort((a, b) => a.score - b.score || a.item.id.localeCompare(b.item.id));
  const result: UniversalFeedItem[] = [];
  while (pool.length) {
    const last = result.at(-1);
    let next = pool.findIndex(
      ({ item }) =>
        item.provider !== last?.provider && item.authorId !== last?.authorId,
    );
    if (next < 0)
      next = pool.findIndex(({ item }) => item.provider !== last?.provider);
    if (next < 0)
      next = pool.findIndex(({ item }) => item.authorId !== last?.authorId);
    result.push(pool.splice(next < 0 ? 0 : next, 1)[0].item);
  }
  return result;
}
