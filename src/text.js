import { decodeHTML } from "entities";

export function decodeEntities(s) {
  return decodeHTML((s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}

export function cleanText(s) {
  const noCdata = String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeHTML(noCdata.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

// Like cleanText, but preserves paragraph/line breaks from block-level HTML
// (<p>, <br>, list items, headings…) so episode descriptions keep their
// structure. Render with `white-space: pre-line` to honor the newlines.
export function cleanRichText(s) {
  const noCdata = String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const withBreaks = noCdata
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/\n?<(p|div|h[1-6]|blockquote|li|ul|ol|tr)[^>]*>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|blockquote|li|ul|ol|tr)>\n?/gi, "\n");
  const lines = decodeHTML(withBreaks.replace(/<[^>]*>/g, ""))
    .split("\n")
    .map((line) => line.replace(/[ \t\xa0]+/g, " ").trim());
  const out = [];
  for (const line of lines) {
    if (line === "" && out.length && out[out.length - 1] === "") continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

// Anchor/Spotify episode audio comes as a tracking redirect
// (…/podcast/play/<id>/<url-encoded-mp3>) which privacy-focused browsers
// block. Unwrap it to the underlying direct mp3 URL so <audio> plays
// everywhere. Non-Anchor URLs pass through unchanged.
export function directAudio(url) {
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
