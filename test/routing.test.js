import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
import { SERMON_FEED_URL, PODCAST_FEED_URL } from "../src/feed.js";

const DIRECT = "https://example.com/ep1.mp3";
const TRACKING = "https://anchor.fm/s/abc/podcast/play/999/" + encodeURIComponent(DIRECT);

function rss(title, itemsXml) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>${title}</title>${itemsXml}</channel></rss>`;
}

const SERMON_RSS = rss("Sermons", `
<item><title>Acts 19:1-20</title><guid>https://example.com/ep1</guid><pubDate>Sun, 09 Nov 2025 17:00:00 GMT</pubDate><enclosure url="${TRACKING}" type="audio/mpeg"/><itunes:image href="https://example.com/art1.jpg"/><description><![CDATA[Speaker: Rich Richardson<br>Paul in Ephesus.]]></description></item>
<item><title>Acts 20:13-38</title><guid>https://example.com/ep2</guid><pubDate>Sun, 02 Nov 2025 17:00:00 GMT</pubDate><enclosure url="https://example.com/ep2.mp3" type="audio/mpeg"/><itunes:image href="https://example.com/art2.jpg"/><description><![CDATA[Speaker: Frank Lundy<br>Paul's farewell.]]></description></item>`);

const PODCAST_RSS = rss("Podcast", `
<item><title>Hello World Episode</title><guid>https://example.com/pod1</guid><pubDate>Sun, 09 Nov 2025 17:00:00 GMT</pubDate><enclosure url="https://example.com/pod1.mp3" type="audio/mpeg"/><description>Just chatting.</description></item>`);

let pcoPayload = null;

function makeCacheStore() {
  const m = new Map();
  return {
    async match(key) {
      const k = key instanceof Request ? key.url : String(key);
      const v = m.get(k);
      return v ? v.clone() : undefined;
    },
    async put(key, val) {
      m.set(key instanceof Request ? key.url : String(key), val.clone());
    },
  };
}

function makeEnv() {
  return {
    ASSETS: {
      fetch: async (req) => {
        const u = new URL(req instanceof Request ? req.url : String(req));
        if (u.pathname === "/") return new Response("static", { status: 200 });
        if (u.pathname === "/404")
          return new Response("<h1>custom 404 page</h1>", {
            status: 200,
            headers: { "content-type": "text/html;charset=UTF-8" },
          });
        return new Response("not found", { status: 404 });
      },
    },
  };
}

beforeEach(() => {
  globalThis.caches = { default: makeCacheStore() };
  pcoPayload = null;
  globalThis.fetch = async (input) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u === SERMON_FEED_URL) return new Response(SERMON_RSS, { status: 200 });
    if (u === PODCAST_FEED_URL) return new Response(PODCAST_RSS, { status: 200 });
    if (u.includes("planningcenteronline.com")) {
      if (pcoPayload)
        return new Response(JSON.stringify(pcoPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      throw new Error("unexpected PCO fetch with no payload configured: " + u);
    }
    throw new Error("unexpected network fetch (leak!): " + u);
  };
});

describe("routing", () => {
  it("GET /api/sermons returns latest + series", async () => {
    const res = await worker.fetch(new Request("https://centergilbert.com/api/sermons"), makeEnv(), {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.latest.length, 2);
    assert.ok(body.series, "expected series");
  });

  it("GET /api/sermons/search filters by q", async () => {
    const res = await worker.fetch(
      new Request("https://centergilbert.com/api/sermons/search?q=ephesus"),
      makeEnv(),
      {}
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 1);
    assert.equal(body.items[0].title, "Acts 19:1-20");
  });

  it("GET /api/podcast returns 200", async () => {
    const res = await worker.fetch(new Request("https://centergilbert.com/api/podcast"), makeEnv(), {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 1);
  });

  it("GET /api/calendar without credentials returns 502", async () => {
    const res = await worker.fetch(new Request("https://centergilbert.com/api/calendar"), makeEnv(), {});
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.ok(body.error.includes("Calendar"), JSON.stringify(body));
  });

  it("GET /api/calendar with credentials filters to visible events", async () => {
    pcoPayload = {
      data: [
        {
          id: "1", type: "EventInstance",
          attributes: { starts_at: "2026-11-20T10:00:00Z", ends_at: "2026-11-20T11:00:00Z", all_day_event: false, location: "Room A", recurrence_description: "", church_center_url: "https://example.com/1" },
          relationships: { event: { data: { id: "10", type: "Event" } }, tags: { data: [] } },
        },
        {
          id: "2", type: "EventInstance",
          attributes: { starts_at: "2026-11-21T10:00:00Z", ends_at: "2026-11-21T11:00:00Z", all_day_event: false, location: "Room B", recurrence_description: "", church_center_url: "https://example.com/2" },
          relationships: { event: { data: { id: "11", type: "Event" } }, tags: { data: [] } },
        },
      ],
      included: [
        { id: "10", type: "Event", attributes: { name: "Visible Gathering", visible_in_church_center: true, description: "Fun" } },
        { id: "11", type: "Event", attributes: { name: "Hidden Meeting", visible_in_church_center: false } },
      ],
    };
    const env = { ...makeEnv(), PLANNING_CENTER_CLIENT_ID: "id", PLANNING_CENTER_SECRET: "secret" };
    const res = await worker.fetch(new Request("https://centergilbert.com/api/calendar"), env, {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].name, "Visible Gathering");
  });

  it("GET /add-sermon redirects to Spotify for Creators", async () => {
    const res = await worker.fetch(new Request("https://centergilbert.com/add-sermon"), makeEnv(), {});
    assert.equal(res.status, 302);
    assert.ok(res.headers.get("location").includes("creators.spotify.com"), res.headers.get("location"));
  });

  it("GET /go/shippy redirects to Church Center", async () => {
    const res = await worker.fetch(new Request("https://centergilbert.com/go/shippy"), makeEnv(), {});
    assert.equal(res.status, 302);
    assert.ok(res.headers.get("location").includes("churchcenter.com"), res.headers.get("location"));
  });

  it("GET /go/unknown falls through to ASSETS", async () => {
    const res = await worker.fetch(new Request("https://centergilbert.com/go/unknown"), makeEnv(), {});
    assert.equal(res.status, 404);
  });

  it("GET /some-page serves the custom 404 page", async () => {
    const res = await worker.fetch(new Request("https://centergilbert.com/some-page"), makeEnv(), {});
    assert.equal(res.status, 404);
    assert.ok((await res.text()).includes("custom 404 page"));
  });
});
