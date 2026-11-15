import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanText, cleanRichText, directAudio } from "../src/text.js";

describe("cleanText", () => {
  it("strips tags and decodes entities", () => {
    assert.equal(cleanText("<p>Hello &amp; <b>world</b></p>"), "Hello & world");
  });

  it("decodes CDATA content", () => {
    assert.equal(cleanText("<![CDATA[fish &amp; chips]]>"), "fish & chips");
  });

  it("collapses whitespace and trims", () => {
    assert.equal(cleanText("  hello   \n\t  world  "), "hello world");
  });
});

describe("cleanRichText", () => {
  it("keeps paragraph breaks as newlines", () => {
    assert.equal(cleanRichText("<p>One</p><p>Two</p>"), "One\nTwo");
  });

  it("keeps <br> breaks as newlines", () => {
    assert.equal(cleanRichText("a<br>b"), "a\nb");
  });

  it("keeps list items as bulleted lines", () => {
    const out = cleanRichText("<ul><li>a</li><li>b</li></ul>");
    assert.ok(out.includes("• a"), `missing bullet a: ${JSON.stringify(out)}`);
    assert.ok(out.includes("• b"), `missing bullet b: ${JSON.stringify(out)}`);
    assert.ok(out.includes("\n"), "expected newline between items");
  });
});

describe("directAudio", () => {
  it("unwraps Anchor tracking URLs to the direct mp3", () => {
    const direct = "https://example.com/ep1.mp3";
    const tracking = "https://anchor.fm/s/abc/podcast/play/999/" + encodeURIComponent(direct);
    assert.equal(directAudio(tracking), direct);
  });

  it("passes non-Anchor mp3 URLs through unchanged", () => {
    assert.equal(directAudio("https://example.com/x.mp3"), "https://example.com/x.mp3");
  });

  it("passes non-mp3 URLs through unchanged", () => {
    const page = "https://anchor.fm/s/abc/podcast/play/123/" + encodeURIComponent("https://example.com/page");
    assert.equal(directAudio(page), page);
  });
});
