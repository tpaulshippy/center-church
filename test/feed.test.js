import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, monthLabel, buildFacets } from "../src/feed.js";

const DIRECT1 = "https://example.com/ep1.mp3";
const DIRECT2 = "https://example.com/ep2.mp3";
const TRACKING1 = "https://anchor.fm/s/abc/podcast/play/999/" + encodeURIComponent(DIRECT1);

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel><title>Test Sermons</title>
<item>
<title>Acts 19:1-20</title>
<guid>https://example.com/ep1</guid>
<pubDate>Sun, 09 Nov 2025 17:00:00 GMT</pubDate>
<enclosure url="${TRACKING1}" type="audio/mpeg"/>
<itunes:image href="https://example.com/art1.jpg"/>
<description><![CDATA[Paul in Ephesus.<br>Speaker: Rich Richardson]]></description>
</item>
<item>
<title>Acts 20:13-38</title>
<guid>https://example.com/ep2</guid>
<pubDate>Sun, 02 Nov 2025 17:00:00 GMT</pubDate>
<enclosure url="${DIRECT2}" type="audio/mpeg"/>
<itunes:image href="https://example.com/art2.jpg"/>
<description><![CDATA[Paul's farewell.<br>Speaker: Frank Lundy]]></description>
</item>
<item>
<guid>https://example.com/untitled</guid>
<pubDate>Sun, 26 Oct 2025 17:00:00 GMT</pubDate>
<enclosure url="https://example.com/ep3.mp3" type="audio/mpeg"/>
<description>No title here.</description>
</item>
</channel></rss>`;

describe("parseFeed", () => {
  const items = parseFeed(RSS);

  it("drops items without a title", () => {
    assert.equal(items.length, 2);
  });

  it("parses titles", () => {
    assert.deepEqual(items.map((i) => i.title), ["Acts 19:1-20", "Acts 20:13-38"]);
  });

  it("takes the speaker from the Speaker line", () => {
    assert.equal(items[0].speaker, "Rich Richardson");
    assert.equal(items[1].speaker, "Frank Lundy");
  });

  it("strips the Speaker line from the description", () => {
    assert.ok(!items[0].description.includes("Speaker:"), items[0].description);
    assert.ok(items[0].description.includes("Paul in Ephesus."), items[0].description);
  });

  it("unwraps tracking audio URLs and parses ISO dates", () => {
    assert.equal(items[0].audio, DIRECT1);
    assert.equal(items[1].audio, DIRECT2);
    assert.equal(items[0].date, "2025-11-09T17:00:00.000Z");
    assert.equal(items[1].date, "2025-11-02T17:00:00.000Z");
  });
});

describe("monthLabel", () => {
  it("formats YYYY-MM", () => {
    assert.equal(monthLabel("2026-11"), "November 2026");
  });

  it("passes garbage through", () => {
    assert.equal(monthLabel("nope"), "nope");
  });
});

describe("buildFacets", () => {
  it("sorts speakers A-Z and months newest-first", () => {
    const facets = buildFacets([
      { title: "B", speaker: "Zed Zebra", date: "2026-09-01T00:00:00.000Z" },
      { title: "A", speaker: "Amy Adams", date: "2026-11-01T00:00:00.000Z" },
    ]);
    assert.deepEqual(facets.speakers.map((s) => s.name), ["Amy Adams", "Zed Zebra"]);
    assert.deepEqual(facets.months.map((m) => m.id), ["2026-11", "2026-09"]);
  });
});
