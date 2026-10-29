/** Local HTTP metadata only; every feed provider request in E2E is redirected here explicitly. */
export function feedFixture(
  provider: string,
  pathname: string,
  query: URLSearchParams,
): unknown {
  const now = "2026-10-28T12:00:00Z";
  if (provider === "bluesky" && pathname.endsWith("searchActors"))
    return {
      actors: [
        {
          did: "did:plc:searchcreator",
          handle: "searchcreator.bsky.social",
          displayName: "Search Creator",
          description: "Technology and education",
        },
      ],
    };
  if (provider === "bluesky") {
    const result = {
      feed: Array.from({ length: 40 }, (_, i) => ({
        post: {
          uri: `at://did:plc:feed${i % 6}/app.bsky.feed.post/feedkey${i}`,
          author: {
            did: `did:plc:feed${i % 6}`,
            displayName: `Feed Creator ${i % 6}`,
            handle: `feed${i % 6}.bsky.social`,
          },
          record: {
            text: `Technology and education fixture perspective ${i}. A real cached API response in the isolated browser harness.`,
            createdAt: now,
          },
          embed:
            i % 3 === 0
              ? {
                  $type: "app.bsky.embed.video#view",
                  thumbnail: "https://cdn.fixture.test/video.jpg",
                }
              : i % 3 === 1
                ? {
                    $type: "app.bsky.embed.images#view",
                    images: [
                      {
                        fullsize: "https://cdn.fixture.test/image.jpg",
                        alt: "Fixture landscape",
                      },
                    ],
                  }
                : {},
          likeCount: i,
          replyCount: i % 4,
        },
      })),
    };
    return pathname.endsWith("searchPosts")
      ? { posts: result.feed.map((entry) => entry.post) }
      : result;
  }
  if (provider === "mastodon") {
    const statuses = Array.from({ length: 30 }, (_, i) => ({
      id: String(1000 + i),
      visibility: "public",
      url: `https://mastodon.social/@feedcreator/${1000 + i}`,
      content: `<p>Community fixture perspective ${i}: learning and new ideas.</p>`,
      account: {
        id: "123",
        display_name: "Community Creator",
        acct: "feedcreator",
      },
      created_at: now,
      media_attachments: [],
      favourites_count: i,
    }));
    return pathname === "/api/v2/search"
      ? {
          accounts: [
            {
              id: "123",
              username: "feedcreator",
              acct: "feedcreator",
              display_name: "Community Creator",
              note: "<p>Public fixture account</p>",
              url: "https://mastodon.social/@feedcreator",
            },
          ],
          statuses,
          hashtags: [
            {
              name: "education",
              url: "https://mastodon.social/tags/education",
            },
          ],
        }
      : statuses;
  }
  if (
    provider === "youtube" &&
    pathname.endsWith("/search") &&
    query.get("type") === "channel"
  )
    return {
      items: [
        {
          id: { channelId: "UC1234567890123456789012" },
          snippet: {
            title: "Video Creator",
            description: "Education videos",
          },
        },
      ],
    };
  if (provider === "youtube" && pathname.endsWith("/search"))
    return { items: [{ id: { videoId: "abcdefghijk" } }] };
  if (provider === "youtube" && pathname.endsWith("/videos"))
    return {
      items: [
        {
          id: "abcdefghijk",
          snippet: {
            channelTitle: "Video Creator",
            channelId: "UC1234567890123456789012",
            title: "Education video fixture",
            publishedAt: now,
          },
          status: { privacyStatus: "public", embeddable: true },
          statistics: {},
        },
      ],
    };
  if (provider === "youtube")
    return {
      author_name: "Video Creator",
      author_url: "https://www.youtube.com/@creator",
      title: "Education video fixture",
      thumbnail_url: "https://cdn.fixture.test/video.jpg",
    };
  if (provider === "tiktok")
    return {
      author_name: "Short Video Creator",
      author_url: "https://www.tiktok.com/@creator",
      title: "Creative video fixture",
      thumbnail_url: "https://cdn.fixture.test/video.jpg",
      html: "<script>Never trust raw oEmbed HTML</script>",
    };
  return {
    error: "unexpected_feed_fixture",
    provider,
    path: pathname,
    query: query.toString(),
  };
}
