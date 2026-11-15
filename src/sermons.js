import { SERMON_FEED_URL, PODCAST_FEED_URL, SERMON_API_TTL, getFeed, feedError, handleFeedSearch } from "./feed.js";
import { detectSeries } from "./series.js";

export async function handleSermons(request, ctx) {
  try {
    const feed = await getFeed(request, ctx, SERMON_FEED_URL, "/api/sermons-feed");
    const payload = {
      updated: feed.updated,
      total: feed.items.length,
      latest: feed.items.slice(0, 6),
      series: detectSeries(feed.items),
    };
    return new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json;charset=UTF-8",
        "cache-control": "public, max-age=60, s-maxage=" + SERMON_API_TTL + ", stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    return feedError(err, "Sermon");
  }
}

export async function handleSermonSearch(request, ctx) {
  return handleFeedSearch(request, ctx, SERMON_FEED_URL, "/api/sermons-feed", "Sermon");
}

export async function handlePodcast(request, ctx) {
  try {
    const feed = await getFeed(request, ctx, PODCAST_FEED_URL, "/api/podcast-feed");
    const payload = {
      updated: feed.updated,
      total: feed.items.length,
      latest: feed.items.slice(0, 6).map((it) => ({
        title: it.title,
        speaker: it.speaker,
        date: it.date,
        description: it.description,
        audio: it.audio,
        link: it.link,
        ...(it.duration ? { duration: it.duration } : {}),
      })),
    };
    return new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json;charset=UTF-8",
        "cache-control": "public, max-age=60, s-maxage=" + SERMON_API_TTL + ", stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    return feedError(err, "Podcast");
  }
}

export async function handlePodcastSearch(request, ctx) {
  return handleFeedSearch(request, ctx, PODCAST_FEED_URL, "/api/podcast-feed", "Podcast");
}
