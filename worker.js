const SERMON_FEED_URL = "https://hub.centergilbert.com/media/podcast/30626/feed.rss";
const PODCAST_FEED_URL = "https://anchor.fm/s/e750e370/podcast/rss";
const SERMON_API_TTL = 300; // seconds to cache the parsed feed; short so newly published sermons show up within minutes

// Canonical Bible book names keyed by lowercase lookup (with common aliases).
const BIBLE_BOOKS = {
  "genesis": "Genesis", "exodus": "Exodus", "leviticus": "Leviticus",
  "numbers": "Numbers", "deuteronomy": "Deuteronomy", "joshua": "Joshua",
  "judges": "Judges", "ruth": "Ruth", "1 samuel": "1 Samuel", "2 samuel": "2 Samuel",
  "1 kings": "1 Kings", "2 kings": "2 Kings", "1 chronicles": "1 Chronicles",
  "2 chronicles": "2 Chronicles", "ezra": "Ezra", "nehemiah": "Nehemiah",
  "esther": "Esther", "job": "Job", "psalm": "Psalms", "psalms": "Psalms",
  "proverbs": "Proverbs", "ecclesiastes": "Ecclesiastes",
  "song of solomon": "Song of Solomon", "song of songs": "Song of Solomon",
  "song": "Song of Solomon", "isaiah": "Isaiah", "jeremiah": "Jeremiah",
  "lamentations": "Lamentations", "ezekiel": "Ezekiel", "daniel": "Daniel",
  "hosea": "Hosea", "joel": "Joel", "amos": "Amos", "obadiah": "Obadiah",
  "jonah": "Jonah", "micah": "Micah", "nahum": "Nahum", "habakkuk": "Habakkuk",
  "zephaniah": "Zephaniah", "haggai": "Haggai", "zechariah": "Zechariah",
  "malachi": "Malachi", "matthew": "Matthew", "mark": "Mark", "luke": "Luke",
  "john": "John", "acts": "Acts", "romans": "Romans",
  "1 corinthians": "1 Corinthians", "2 corinthians": "2 Corinthians",
  "galatians": "Galatians", "ephesians": "Ephesians", "philippians": "Philippians",
  "colossians": "Colossians", "1 thessalonians": "1 Thessalonians",
  "2 thessalonians": "2 Thessalonians", "1 timothy": "1 Timothy",
  "2 timothy": "2 Timothy", "titus": "Titus", "philemon": "Philemon",
  "hebrews": "Hebrews", "james": "James", "1 peter": "1 Peter", "2 peter": "2 Peter",
  "1 john": "1 John", "2 john": "2 John", "3 john": "3 John",
  "jude": "Jude", "revelation": "Revelation",
};

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function cleanText(s) {
  return decodeEntities(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Anchor/Spotify episode audio comes as a tracking redirect
// (…/podcast/play/<id>/<url-encoded-mp3>) which privacy-focused browsers
// block. Unwrap it to the underlying direct mp3 URL so <audio> plays
// everywhere. Non-Anchor URLs pass through unchanged.
function directAudio(url) {
  const u = String(url || "").trim();
  const m = u.match(/\/play\/[^/]+\/(.+)$/);
  if (m) {
    try {
      const d = decodeURIComponent(m[1]);
      if (/^https?:\/\/.+\.mp3(\?.*)?$/i.test(d)) return d;
    } catch (e) { /* fall through to original */ }
  }
  return u;
}

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const get = (re) => {
      const m = b.match(re);
      return m ? cleanText(m[1]) : "";
    };
    const enclosure = directAudio((b.match(/<enclosure[^>]*url="([^"]+)"/i) || [])[1] || "");
    const image = (b.match(/<itunes:image[^>]*href="([^"]+)"/i) || [])[1] || "";
    const duration = get(/<itunes:duration>([\s\S]*?)<\/itunes:duration>/i);
    const pubRaw = get(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const time = Date.parse(pubRaw);
    items.push({
      title: get(/<title>([\s\S]*?)<\/title>/i),
      speaker: get(/<itunes:author>([\s\S]*?)<\/itunes:author>/i),
      description: get(/<(?:itunes:summary|description)>([\s\S]*?)<\/(?:itunes:summary|description)>/i),
      link: get(/<link>([\s\S]*?)<\/link>/i),
      audio: enclosure.trim(),
      image: image.trim(),
      duration: duration.trim(),
      date: isNaN(time) ? null : new Date(time).toISOString(),
    });
  }
  return items.filter((it) => it.title);
}

// Match a leading Bible-book reference, e.g. "Acts 19:1-20" -> "Acts",
// "2 Corinthians 1:12-22" -> "2 Corinthians". Returns null when no match.
function bookFromTitle(title) {
  const m = String(title || "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .match(/^\s*([123])?\s*([a-z][a-z' ]*?)\s+\d/);
  if (!m) return null;
  const key = ((m[1] ? m[1] + " " : "") + m[2]).replace(/\s+/g, " ").trim();
  return BIBLE_BOOKS[key] || null;
}

// Group a sermon title into a series key so the current series can be
// detected with zero manual updates. Handles both book series ("Acts 19…")
// and topical series ("Ask God Anything: …").
function seriesKeyOf(title) {
  const t = String(title || "").trim().replace(/^(Sunday Sermon|Sermon)\s*:\s*/i, "");
  const book = bookFromTitle(t);
  if (book) return { kind: "book", name: book };
  const tail = t.match(/-\s*([^-<>]{2,60})$/);
  if (tail) {
    const b = bookFromTitle(tail[1].trim());
    if (b) return { kind: "book", name: b };
  }
  const colon = t.match(/^([^:?«»()]{3,48}?):\s*\S/);
  if (colon && !/^\d/.test(colon[1].trim())) {
    return { kind: "topical", name: colon[1].trim() };
  }
  return null;
}

// The current series is whatever most of the recent sermons belong to, so
// one-offs (anniversary services, guest speakers) don't change the
// spotlight and a new series takes over on its own after a few weeks.
function detectSeries(items) {
  const recent = items.slice(0, 10);
  const counts = new Map();
  const keys = recent.map((it) => seriesKeyOf(it.title));
  keys.forEach((k) => {
    if (!k) return;
    const id = k.kind + ":" + k.name.toLowerCase();
    const entry = counts.get(id) || { key: k, count: 0 };
    entry.count += 1;
    counts.set(id, entry);
  });
  let best = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  if (best && best.count >= 2) {
    const inSeries = items.filter((it) => {
      const k = seriesKeyOf(it.title);
      return k && k.kind === best.key.kind && k.name.toLowerCase() === best.key.name.toLowerCase();
    });
    const blurb =
      best.key.kind === "book"
        ? `We're currently preaching verse-by-verse through ${best.key.name}.`
        : `Our current series: ${best.key.name}.`;
    return {
      name: best.key.name,
      kind: best.key.kind,
      blurb,
      artwork: (inSeries[0] && inSeries[0].image) || "",
      sermons: inSeries.slice(0, 5),
    };
  }
  // No clear series (e.g. between series): spotlight the single latest message.
  const latest = items[0];
  return {
    name: latest ? latest.title : "Latest messages",
    kind: "latest",
    blurb: "Our most recent message.",
    artwork: (latest && latest.image) || "",
    sermons: latest ? [latest] : [],
  };
}

// Fetches and parses a podcast feed, cached for SERMON_API_TTL so a newly
// published episode shows up within minutes. Shared by the spotlight
// (/api/sermons, /api/podcast) and the archive search handlers.
async function getFeed(request, ctx, feedUrl, cachePath) {
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

function feedError(err, label) {
  return new Response(JSON.stringify({ error: label + " feed unavailable", detail: String(err && err.message || err) }), {
    status: 502,
    headers: { "content-type": "application/json;charset=UTF-8", "cache-control": "no-store" },
  });
}

async function handleSermons(request, ctx) {
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

function monthLabel(id) {
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
function buildFacets(items) {
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
async function handleFeedSearch(request, ctx, feedUrl, cachePath, label) {
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
      filtered = filtered.filter((it) => ((it.title || "") + " " + (it.speaker || "") + " " + (it.description || "")).toLowerCase().includes(q));
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

async function handleSermonSearch(request, ctx) {
  return handleFeedSearch(request, ctx, SERMON_FEED_URL, "/api/sermons-feed", "Sermon");
}

async function handlePodcast(request, ctx) {
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

async function handlePodcastSearch(request, ctx) {
  return handleFeedSearch(request, ctx, PODCAST_FEED_URL, "/api/podcast-feed", "Podcast");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/sermons/search") {
      return handleSermonSearch(request, ctx);
    }
    if (url.pathname === "/api/sermons") {
      return handleSermons(request, ctx);
    }
    if (url.pathname === "/api/podcast/search") {
      return handlePodcastSearch(request, ctx);
    }
    if (url.pathname === "/api/podcast") {
      return handlePodcast(request, ctx);
    }
    const res = await env.ASSETS.fetch(request);

    // Serve our custom 404 page for unknown paths (but leave real assets alone).
    if (res.status === 404 && !url.pathname.includes(".")) {
      const notFound = await env.ASSETS.fetch(
        new Request(new URL("/404", request.url), request)
      );
      if (notFound.ok) {
        return new Response(await notFound.text(), {
          status: 404,
          headers: { "content-type": "text/html;charset=UTF-8" },
        });
      }
    }
    return res;
  },
};
