// Canonical Bible book names keyed by lowercase lookup (with common aliases).
export const BIBLE_BOOKS = {
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

// Match a leading Bible-book reference, e.g. "Acts 19:1-20" -> "Acts",
// "2 Corinthians 1:12-22" -> "2 Corinthians". Returns null when no match.
export function bookFromTitle(title) {
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
export function seriesKeyOf(title) {
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
export function detectSeries(items) {
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
