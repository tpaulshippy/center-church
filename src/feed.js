import { SPEAKER_MAP, SPEAKER_NAMES } from "../speakers.js";
import { cleanText, cleanRichText, directAudio } from "./text.js";
import { seriesKeyOf } from "./series.js";

export const SERMON_FEED_URL = "https://hub.centergilbert.com/media/podcast/30626/feed.rss";
export const PODCAST_FEED_URL = "https://anchor.fm/s/e750e370/podcast/rss";
export const SERMON_API_TTL = 300; // seconds to cache the parsed feed; short so newly published sermons show up within minutes
export const CALENDAR_API_TTL = 300;

export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const get = (re) => {
      const m = b.match(re);
      return m ? cleanText(m[1]) : "";
    };
    const enclosure = directAudio((b.match(/<enclosure[^>]*url="([^"]+)"/i) || [])[1] || "");
    const guid = get(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
    const image = (b.match(/<itunes:image[^>]*href="([^"]+)"/i) || [])[1] || "";
    const duration = get(/<itunes:duration>([\s\S]*?)<\/itunes:duration>/i);
    const rawDesc = (b.match(/<(?:itunes:summary|description)>([\s\S]*?)<\/(?:itunes:summary|description)>/i) || [])[1] || "";
    // Speaker convention for Spotify episodes: start the description with
    // "Speaker: Full Name" on its own line (see PUBLISHING.md). The line is
    // stripped from the displayed description below.
    const richDesc = cleanRichText(rawDesc);
    const tagMatch = richDesc.match(/^\s*Speaker\s*:\s*(.+?)\s*$/im);
    const tagSpeaker = tagMatch ? tagMatch[1].split("|")[0].replace(/\s+/g, " ").trim() : "";
    const flatDesc = cleanText(rawDesc);
    const proseSpeaker =
      SPEAKER_NAMES.find((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(flatDesc)) || "";
    const shownDesc = richDesc
      .split("\n")
      .filter((line) => !/^\s*Speaker\s*:/i.test(line))
      .join("\n")
      .trim();
    const pubRaw = get(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const time = Date.parse(pubRaw);
    // Nucleus carried per-episode <itunes:author>; Spotify/Anchor does not.
    // Chain: feed tag -> "Speaker:" line -> known name in prose -> backfill map.
    const speaker =
      get(/<itunes:author>([\s\S]*?)<\/itunes:author>/i) || tagSpeaker || proseSpeaker || SPEAKER_MAP[guid] || "";
    items.push({
      title: get(/<title>([\s\S]*?)<\/title>/i),
      speaker,
      guid,
      description: shownDesc,
      link: get(/<link>([\s\S]*?)<\/link>/i),
      audio: enclosure.trim(),
      image: image.trim(),
      duration: duration.trim(),
      date: isNaN(time) ? null : new Date(time).toISOString(),
    });
  }
  return items.filter((it) => it.title);
}

// Fetches and parses a podcast feed, cached for SERMON_API_TTL so a newly
// published episode shows up within minutes. Shared by the spotlight
// (/api/sermons, /api/podcast) and the archive search handlers.
export async function getFeed(request, ctx, feedUrl, cachePath) {
  const cache = caches.default;
  const key = new Request(new URL(cachePath, request.url).toString(), request);
  const cached = await cache.match(key);
  if (cached) {
    const data = await cached.json();
    if (data && data.items && data.items.length) return data;
  }
  const rssRes = await fetch(feedUrl, {
    headers: { "user-agent": "CenterChurchSite/1.0 (+https://centergilbert.com)" },
  });
  if (!rssRes.ok) throw new Error("feed status " + rssRes.status);
  const items = parseFeed(await rssRes.text());
  if (!items.length) throw new Error("empty feed");
  const data = { updated: new Date().toISOString(), items };
  const res = new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "cache-control": "public, max-age=60, s-maxage=" + SERMON_API_TTL,
    },
  });
  const put = cache.put(key, res.clone());
  if (ctx && ctx.waitUntil) ctx.waitUntil(put);
  else await put;
  return data;
}

export function feedError(err, label) {
  return new Response(JSON.stringify({ error: label + " feed unavailable", detail: String(err && err.message || err) }), {
    status: 502,
    headers: { "content-type": "application/json;charset=UTF-8", "cache-control": "no-store" },
  });
}

export function monthLabel(id) {
  const m = String(id || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return id;
  try {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(+m[1], +m[2] - 1, 1)));
  } catch (e) {
    return id;
  }
}

// Filter dropdown contents, computed over the full feed so the lists stay
// complete: distinct speakers (A–Z), series grouped like detectSeries
// (most recent first), and months present in the feed (newest first).
export function buildFacets(items) {
  const speakers = new Map();
  const series = new Map();
  const months = new Map();
  items.forEach((it, idx) => {
    if (it.speaker) {
      const e = speakers.get(it.speaker) || { name: it.speaker, count: 0 };
      e.count += 1;
      speakers.set(it.speaker, e);
    }
    const k = seriesKeyOf(it.title);
    if (k) {
      const id = k.kind + ":" + k.name.toLowerCase();
      const e = series.get(id) || { name: k.name, kind: k.kind, count: 0, last: idx };
      e.count += 1;
      e.last = Math.min(e.last, idx);
      series.set(id, e);
    }
    if (it.date && /^\d{4}-\d{2}/.test(it.date)) {
      const id = it.date.slice(0, 7);
      const e = months.get(id) || { id, label: monthLabel(id), count: 0 };
      e.count += 1;
      months.set(id, e);
    }
  });
  return {
    speakers: [...speakers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    series: [...series.values()]
      .sort((a, b) => a.last - b.last)
      .filter((e) => e.count >= 2)
      .map((e) => ({ name: e.name, kind: e.kind, count: e.count })),
    months: [...months.values()].sort((a, b) => (a.id < b.id ? 1 : -1)),
  };
}

// Paginated, searchable, filterable archive over a full feed. q matches
// title, speaker, and description; speaker/series/month narrow it further
// (all combined with AND). Empty values browse everything, newest first.
export async function handleFeedSearch(request, ctx, feedUrl, cachePath, label) {
  try {
    const url = new URL(request.url);
    const qRaw = (url.searchParams.get("q") || "").trim().slice(0, 60);
    const q = qRaw.toLowerCase();
    const speakerRaw = (url.searchParams.get("speaker") || "").trim().slice(0, 60);
    const seriesRaw = (url.searchParams.get("series") || "").trim().slice(0, 60);
    const monthParam = (url.searchParams.get("month") || "").trim();
    const month = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : "";
    const per = Math.min(50, Math.max(5, parseInt(url.searchParams.get("per") || "10", 10) || 10));
    const feed = await getFeed(request, ctx, feedUrl, cachePath);
    const facets = buildFacets(feed.items);
    let filtered = feed.items;
    if (q) {
      filtered = filtered.filter((it) => ((it.title || "") + " " + (it.speaker || "") + " " + (it.description || "")).replace(/\s+/g, " ").toLowerCase().includes(q));
    }
    if (speakerRaw) {
      const s = speakerRaw.toLowerCase();
      filtered = filtered.filter((it) => (it.speaker || "").toLowerCase() === s);
    }
    if (seriesRaw) {
      const s = seriesRaw.toLowerCase();
      filtered = filtered.filter((it) => {
        const k = seriesKeyOf(it.title);
        return k && k.name.toLowerCase() === s;
      });
    }
    if (month) {
      filtered = filtered.filter((it) => it.date && it.date.slice(0, 7) === month);
    }
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / per));
    const page = Math.min(totalPages, Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1));
    const items = filtered.slice((page - 1) * per, page * per).map((it) => ({
      title: it.title,
      speaker: it.speaker,
      guid: it.guid,
      date: it.date,
      description: it.description,
      audio: it.audio,
      link: it.link,
      ...(it.duration ? { duration: it.duration } : {}),
    }));
    return new Response(JSON.stringify({
      q: qRaw, speaker: speakerRaw, series: seriesRaw, month,
      month_label: month ? monthLabel(month) : "",
      total, page, per_page: per, total_pages: totalPages, items, facets,
    }), {
      headers: {
        "content-type": "application/json;charset=UTF-8",
        "cache-control": "public, max-age=60, s-maxage=" + SERMON_API_TTL,
      },
    });
  } catch (err) {
    return feedError(err, label);
  }
}
