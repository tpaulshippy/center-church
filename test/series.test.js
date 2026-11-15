import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bookFromTitle, seriesKeyOf, detectSeries } from "../src/series.js";

describe("bookFromTitle", () => {
  it("matches a plain book reference", () => {
    assert.equal(bookFromTitle("Acts 19:1-20"), "Acts");
  });

  it("matches a numbered book reference", () => {
    assert.equal(bookFromTitle("2 Corinthians 1:12-22"), "2 Corinthians");
  });

  it("returns null for non-references", () => {
    assert.equal(bookFromTitle("Ask God Anything: Why Suffering?"), null);
    assert.equal(bookFromTitle("Hello world"), null);
  });
});

describe("seriesKeyOf", () => {
  it("groups book titles", () => {
    assert.deepEqual(seriesKeyOf("Acts 19:1-20"), { kind: "book", name: "Acts" });
  });

  it("groups topical colon titles", () => {
    assert.deepEqual(seriesKeyOf("Ask God Anything: Why is there suffering?"), {
      kind: "topical",
      name: "Ask God Anything",
    });
  });

  it("strips the Sunday Sermon prefix", () => {
    assert.deepEqual(seriesKeyOf("Sunday Sermon: Acts 19:1-20"), { kind: "book", name: "Acts" });
  });
});

describe("detectSeries", () => {
  it("detects a repeated book series with blurb, artwork, and sermons", () => {
    const items = [
      { title: "Acts 19:1-20", image: "art.jpg" },
      { title: "Acts 20:13-38", image: "art2.jpg" },
      { title: "Acts 21:1-14", image: "art3.jpg" },
      { title: "Easter Sunday", image: "other.jpg" },
    ];
    const s = detectSeries(items);
    assert.equal(s.kind, "book");
    assert.equal(s.name, "Acts");
    assert.ok(s.blurb && s.blurb.length > 0, "expected a blurb");
    assert.equal(s.artwork, "art.jpg");
    assert.equal(s.sermons.length, 3);
  });

  it("falls back to latest when titles are all different", () => {
    const items = [
      { title: "Easter Sunday", image: "a.jpg" },
      { title: "Christmas Eve", image: "b.jpg" },
      { title: "Guest Speaker Night", image: "c.jpg" },
    ];
    const s = detectSeries(items);
    assert.equal(s.kind, "latest");
    assert.equal(s.sermons.length, 1);
    assert.equal(s.sermons[0].title, "Easter Sunday");
  });
});
