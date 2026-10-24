import { describe, expect, it } from "vitest";

// The vault requires a key; tests use a fixed one (never a real secret).
process.env.ARIA_ENCRYPTION_KEY ??= "3f2a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a8c9e1b7d5f4a";

import {
  createPkcePair,
  createState,
  normalizeInstance,
  buildAuthorizeUrl,
} from "../src/oauth.js";
import { blueskyCreateSession, blueskyCreatePost } from "../src/bluesky.js";
import {
  ensureMastodonApp,
  mastodonPostStatus,
  mastodonVerifyCredentials,
} from "../src/mastodon.js";
import { fetchJson, ProviderHttpError } from "../src/http.js";
import type { AriaDatabase } from "@aria/db";

describe("OAuth primitives", () => {
  it("creates PKCE pairs where the challenge is the S256 of the verifier", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(challenge).not.toBe(verifier);
    expect(challenge.length).toBe(43);
  });

  it("state tokens are unguessable", () => {
    expect(createState()).not.toBe(createState());
    expect(createState()).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it("normalizes instance URLs strictly", () => {
    expect(normalizeInstance("mastodon.social")).toBe("https://mastodon.social");
    expect(normalizeInstance("https://mastodon.social/")).toBe("https://mastodon.social");
    expect(() => normalizeInstance("https://mastodon.social/about")).toThrow();
  });

  it("refuses unconfigured providers with a registration hint", async () => {
    delete process.env.FACEBOOK_APP_ID;
    await expect(buildAuthorizeUrl("facebook", {})).rejects.toThrow(/register the developer app/i);
  });

  it("builds a TikTok authorize URL with PKCE", async () => {
    process.env.TIKTOK_CLIENT_KEY = "test-key";
    process.env.TIKTOK_CLIENT_SECRET = "test-secret";
    const { url, codeVerifier } = await buildAuthorizeUrl("tiktok");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("client_key=test-key");
    expect(codeVerifier).toBeTruthy();
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.TIKTOK_CLIENT_SECRET;
  });
});

describe("Bluesky client (injected fetch)", () => {
  it("creates a session and never logs the password", async () => {
    let capturedBody = "";
    const fake = (async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({ accessJwt: "a.jwt", refreshJwt: "r.jwt", did: "did:x", handle: "b" }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    const s = await blueskyCreateSession("maya.bsky.social", "app-pass", { fetchImpl: fake });
    expect(s.did).toBe("did:x");
    expect(capturedBody).toContain("app-pass");
  });

  it("surfaces session failures as ProviderHttpError with redacted bodies", async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ error: "AuthenticationFailed", token: "skjdhfaksjdhfkajshdfkahsdfkjh" }), {
        status: 401,
      })) as unknown as typeof fetch;
    await expect(
      blueskyCreateSession("maya.bsky.social", "wrong", { fetchImpl: fake })
    ).rejects.toBeInstanceOf(ProviderHttpError);
  });

  it("builds a createRecord payload with the right collection", async () => {
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    const fake = (async (url: string, init?: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) };
      return new Response(JSON.stringify({ uri: "at://did/app.bsky.feed.post/abc", cid: "cid" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await blueskyCreatePost(
      { accessJwt: "jwt", did: "did:x" },
      { did: "did:x", text: "Hello fediverse" },
      { fetchImpl: fake }
    );
    expect(r.uri).toContain("app.bsky.feed.post");
    expect(captured!.url).toContain("com.atproto.repo.createRecord");
    expect(captured!.body.collection).toBe("app.bsky.feed.post");
    expect((captured!.body.record as Record<string, unknown>).text).toBe("Hello fediverse");
  });
});

describe("Mastodon client (injected fetch)", () => {
  const fakeDb = () => {
    const rows: Array<Record<string, unknown>> = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => rows }),
        }),
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          onConflictDoNothing: async () => {
            rows.push(v);
          },
        }),
      }),
    } as unknown as AriaDatabase;
    return { db, rows };
  };

  it("verifies credentials with a bearer token", async () => {
    let authHeader = "";
    const fake = (async (_url: string, init?: RequestInit) => {
      authHeader = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      return new Response(JSON.stringify({ id: "1", username: "maya", display_name: "Maya" }), { status: 200 });
    }) as unknown as typeof fetch;
    const acct = await mastodonVerifyCredentials("https://mastodon.social", "tok", { fetchImpl: fake });
    expect(acct.username).toBe("maya");
    expect(authHeader).toBe("Bearer tok");
  });

  it("posts a status with visibility and an Idempotency-Key", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";
    const fake = (async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ id: "42", url: "https://mastodon.social/@maya/42" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await mastodonPostStatus(
      "mastodon.social",
      "tok",
      { status: "Hello", visibility: "unlisted", idempotencyKey: "idem_123" },
      { fetchImpl: fake }
    );
    expect(r.id).toBe("42");
    expect(capturedHeaders["Idempotency-Key"]).toBe("idem_123");
    const parsed = JSON.parse(capturedBody);
    expect(parsed.visibility).toBe("unlisted");
  });

  it("registers the app and persists it (ensureMastodonApp)", async () => {
    const { db, rows } = fakeDb();
    let registered = 0;
    const fake = (async () => {
      registered += 1;
      return new Response(JSON.stringify({ client_id: "cid", client_secret: "sec" }), { status: 200 });
    }) as unknown as typeof fetch;
    const app = await ensureMastodonApp(db, "mastodon.social", { fetchImpl: fake });
    expect(app.clientId).toBe("cid");
    expect(rows.length).toBe(1);
    // Second call within this test hits the in-memory cache — no new registration.
    const again = await ensureMastodonApp(db, "mastodon.social", { fetchImpl: fake });
    expect(again.clientId).toBe("cid");
    expect(registered).toBe(1);
  });

  it("redacts long secrets from error bodies", async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ error: "invalid_grant", access_token: "VERYLONGSECRETVALUE123456789012345" }), {
        status: 400,
      })) as unknown as typeof fetch;
    try {
      await fetchJson("Mastodon", "https://mastodon.social/oauth/token", { method: "POST", fetchImpl: fake });
      expect.unreachable();
    } catch (e) {
      const err = e as ProviderHttpError;
      expect(err.status).toBe(400);
      expect(err.body).not.toContain("VERYLONGSECRETVALUE");
    }
  });
});

describe("single-flight refresh lock", () => {
  it("serializes concurrent refreshes for the same account (other accounts unaffected)", async () => {
    const { withRefreshLock } = await import("../src/credentials.js");
    let acc1InFlight = 0;
    let acc1Max = 0;
    const workAcc1 = () =>
      withRefreshLock("acc1", async () => {
        acc1InFlight += 1;
        acc1Max = Math.max(acc1Max, acc1InFlight);
        await new Promise((r) => setTimeout(r, 25));
        acc1InFlight -= 1;
        return "acc1";
      });
    const workAcc2 = () =>
      withRefreshLock("acc2", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return "acc2";
      });
    await Promise.all([workAcc1(), workAcc1(), workAcc1(), workAcc2()]);
    expect(acc1Max).toBe(1);
  });
});

describe("phase-5 client request shapes (injected fetch)", () => {
  it("youtube: resumable init returns Location, PUT uploads bytes", async () => {
    const { youtubeInitUpload, youtubePutVideo } = await import("../src/youtube.js");
    const calls: Array<{ url: string; method?: string; body?: unknown; loc?: string }> = [];
    const fake = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body });
      if (String(url).includes("uploadType=resumable")) {
        return new Response(null, { status: 200, headers: { Location: "https://upload.session/put" } });
      }
      return new Response(JSON.stringify({ id: "vid_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const meta = { title: "T", description: "D", privacyStatus: "public" as const };
    const init = await youtubeInitUpload("tok", meta, 10, "video/mp4", { fetchImpl: fake });
    expect(init.uploadUrl).toBe("https://upload.session/put");
    await youtubePutVideo(init.uploadUrl, new Uint8Array(10), "video/mp4", { fetchImpl: fake });
    const first = calls[0];
    expect(first.url).toContain("uploadType=resumable&part=snippet,status");
    expect((first.body as string)).toContain('"privacyStatus":"public"');
    expect(calls[1].url).toBe("https://upload.session/put");
  });

  it("facebook: photo upload posts multipart with source", async () => {
    const { facebookUploadPhoto } = await import("../src/facebook.js");
    let auth = "";
    let isForm = false;
    const fake = (async (_url: string | URL, init?: RequestInit) => {
      auth = String((init?.headers as Record<string, string>)?.Authorization);
      isForm = init?.body instanceof FormData;
      return new Response(JSON.stringify({ post_id: "p1", id: "ph1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await facebookUploadPhoto("page1", "tok", { bytes: new Uint8Array(5), mime: "image/jpeg", filename: "a.jpg", caption: "cap" }, { fetchImpl: fake });
    expect(r.postId).toBe("p1");
    expect(auth).toBe("Bearer tok");
    expect(isForm).toBe(true);
  });

  it("x: chunked upload INIT/APPEND/FINALIZE then tweet", async () => {
    const { xUploadMediaBytes, xCreateTweet } = await import("../src/x.js");
    const calls: string[] = [];
    const fake = (async (url: string | URL, init?: RequestInit) => {
      const body = init?.body;
      const rawCommand = body instanceof FormData ? String(body.get("command")) : String(body ?? "");
      const command = rawCommand.startsWith("command=") ? rawCommand.slice(8, rawCommand.indexOf("&") > 8 ? rawCommand.indexOf("&") : undefined) : rawCommand;
      if (command === "INIT") calls.push("INIT");
      else if (command === "APPEND") calls.push("APPEND");
      else if (command === "FINALIZE") calls.push("FINALIZE");
      else if (String(url).includes("/tweets")) {
        calls.push("TWEET:" + String(body));
        return new Response(JSON.stringify({ data: { id: "tw1" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ media_id_string: "m1", media_id: "m1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const mediaId = await xUploadMediaBytes("tok", new Uint8Array(20).fill(7), "image/jpeg", { fetchImpl: fake });
    expect(mediaId).toBe("m1");
    expect(calls).toEqual(["INIT", "APPEND", "FINALIZE"]);
    const r = await xCreateTweet("tok", { text: "hi", mediaIds: ["m1"] }, { fetchImpl: fake });
    expect(r.tweetId).toBe("tw1");
    expect(calls.find((c) => c.startsWith("TWEET"))).toContain('"media":{"media_ids":["m1"]}');
  });

  it("linkedin: registerUpload → PUT → posts with media URN", async () => {
    const { linkedinRegisterUpload, linkedinPutBytes, linkedinCreatePost } = await import("../src/linkedin.js");
    const seen: Array<{ url: string; body?: string; headers?: Record<string, string> }> = [];
    const fake = (async (url: string | URL, init?: RequestInit) => {
      seen.push({ url: String(url), body: typeof init?.body === "string" ? init.body : undefined, headers: init?.headers as Record<string, string> });
      console.log("LI URL:", String(url));
      if (String(url).includes("registerUpload")) {
        return new Response(JSON.stringify({ value: { asset: "urn:li:image:1", uploadMechanism: { "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": { uploadUrl: "https://put.linkedin/1" } } } }), { status: 200 });
      }
      if (String(url).endsWith("/posts")) {
        return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:9" } });
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const reg = await linkedinRegisterUpload("tok", "urn:li:person:sub1", "urn:li:digitalmediaRecipe:feedshare-image", 100, { fetchImpl: fake });
    expect(reg.assetUrn).toBe("urn:li:image:1");
    await linkedinPutBytes(reg.uploadUrl, new Uint8Array(100), "image/jpeg", { fetchImpl: fake });
    await linkedinCreatePost("tok", { authorUrn: "urn:li:person:sub1", commentary: "c", mediaUrn: reg.assetUrn }, { fetchImpl: fake });
    const post = seen.find((s) => s.url.includes("/posts"));
    if (!post) throw new Error("seen URLs: " + seen.map((x) => x.url).join(" | "));
    expect(post.headers?.["LinkedIn-Version"]).toBe("202609");
    expect(post.body).toContain("urn:li:image:1");
    expect(post.body).toContain("urn:li:person:sub1");
  });

  it("pinterest: pin create requires board and media_source", async () => {
    const { pinterestCreatePin } = await import("../src/pinterest.js");
    let captured = "";
    const fake = (async (_url: string | URL, init?: RequestInit) => {
      captured = String(init?.body ?? "");
      return new Response(JSON.stringify({ id: "pin1", link: "https://pinterest.com/pin/pin1" }), { status: 201 });
    }) as unknown as typeof fetch;
    const r = await pinterestCreatePin("tok", { boardId: "brd1", title: "T", description: "D", mediaId: "m1" }, { fetchImpl: fake });
    expect(r.pinId).toBe("pin1");
    const parsed = JSON.parse(captured);
    expect(parsed.board_id).toBe("brd1");
    expect(parsed.media_source.source_type).toBe("media_id");
  });

  it("threads: container → publish with media_type TEXT", async () => {
    const { threadsCreateContainer, threadsPublish } = await import("../src/threads.js");
    const calls: Array<{ url: string; body?: string }> = [];
    const fake = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: typeof init?.body === "string" ? init.body : undefined });
      if (String(url).endsWith("/threads_publish")) return new Response(JSON.stringify({ id: "thpost1" }), { status: 200 });
      return new Response(JSON.stringify({ id: "cont1" }), { status: 200 });
    }) as unknown as typeof fetch;
    await threadsCreateContainer("thuser", "tok", { mediaType: "TEXT", text: "Hello" }, { fetchImpl: fake });
    await threadsPublish("thuser", "tok", "cont1", { fetchImpl: fake });
    expect(calls[0].body).toContain('"media_type":"TEXT"');
    expect(calls[1].url).toContain("threads_publish");
  });
});
