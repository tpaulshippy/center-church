# Publishing a sermon (Spotify for Creators)

The site's speaker filter depends on one convention, because Spotify's RSS
has no per-episode author field (Nucleus had `<itunes:author>`; Anchor drops it).

## Required: first line of the description

Start every episode description with the speaker on its own line:

```
Speaker: Rich Richardson
```

The site reads that line for the speaker filter and hides it from the
displayed description, so listeners never see it. Without it, the episode
shows under no speaker until someone adds it by hand.

Examples that all work:

```
Speaker: Rich Richardson
Acts 19:21-41 | Center Church
```

- Use the speaker's full name as it appears on the site (`Rich Richardson`,
  not `Pastor Rich` — the site also recognizes bare names mentioned anywhere
  in the description, e.g. "Jon Payne preaches on ...", but the `Speaker:`
  line is the reliable path).
- A brand-new speaker (never preached before) works with the `Speaker:` line
  immediately — no code change. Optionally also add their name to
  `SPEAKER_NAMES` in `speakers.js` so prose mentions keep working.

## Backlog

Episodes imported from Nucleus carry their speakers via `speakers.js`
(`SPEAKER_MAP`, keyed by episode GUID). Don't touch it unless an old episode
shows the wrong speaker.

## After publishing

New episodes appear on the site within ~5 minutes (worker cache). If the
speaker filter misses one, check the description's first line first.
