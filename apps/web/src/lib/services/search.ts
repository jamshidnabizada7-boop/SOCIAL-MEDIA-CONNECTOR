"use client";
import {
  platformSearchUrl,
  PROVIDERS,
  type ProviderId,
  type SearchPerson,
  type UniversalSearchResponse,
} from "@aria/shared-types";
import { apiFetch, DATA_MODE } from "@/lib/api/client";
import { feedService } from "./feed";

export async function universalSearch(
  workspace: string,
  user: string,
  query: string,
): Promise<UniversalSearchResponse> {
  if (DATA_MODE === "api")
    return apiFetch<UniversalSearchResponse>(
      `/v1/workspaces/${encodeURIComponent(workspace)}/feed/search/all`,
      {
        method: "POST",
        body: JSON.stringify({ query }),
        timeoutMs: 25000,
      },
    );
  const page = await feedService.list(workspace, user, {
    search: query,
    limit: 30,
  });
  const people = new Map<string, SearchPerson>();
  for (const item of page.items)
    people.set(`${item.provider}:${item.authorId}`, {
      provider: item.provider,
      id: item.authorId,
      name: item.authorName,
      handle: item.authorHandle || "",
      description: "Sample creator for the isolated demo",
      url: item.originalUrl,
      origin: "collected",
    });
  return {
    query,
    people: [...people.values()],
    posts: page.items.map((item) => ({ item, origin: "collected" as const })),
    topics: [],
    coverage: (Object.keys(PROVIDERS) as ProviderId[]).map((provider) => ({
      provider,
      mode: "collected",
      status: "searched",
      message: "Sample data only. No provider API was called.",
      externalUrl: platformSearchUrl(provider, query),
    })),
    searchedAt: new Date().toISOString(),
    sample: true,
  };
}
