# Sermon + podcast transcripts

Everything for turning a sermon recording or podcast episode into a
read-along transcript page lives here. `add-transcript.sh` handles both
kinds via `--kind sermon|podcast` (default `sermon`, `--type` is an
alias; `KIND` env works too). Generated pages are unlinked drafts (not
in nav or sitemap); share the direct `/sermons/<slug>` or
`/podcast/<slug>` path. Both archives link a title automatically once
its episode has a transcript (see Manifest below).

## The free local flow (default)

No API keys, no cost. Needs `whisper-cli` (`brew install whisper-cpp`).

```bash
./scripts/transcripts/transcribe-local.sh "https://.../sermon.mp3" sermon
# -> sermon.txt + sermon.words.json (model cached in ~/.cache/center-church-whisper)

./scripts/transcripts/add-transcript.sh --transcript-file sermon.txt \
    --transcript-words sermon.words.json --pause-gap 1.4 \
    --title "Acts 21:1-14" --slug transcript-acts-21-1-14 --pubdate 2026-11-15
```

Podcast episode (same local flow — output defaults to `public/podcast/`):

```bash
./scripts/transcripts/transcribe-local.sh "https://.../episode.mp3" episode
# -> episode.txt + episode.words.json

./scripts/transcripts/add-transcript.sh --kind podcast --transcript-file episode.txt \
    --transcript-words episode.words.json --pause-gap 1.4 \
    --title "Episode Title" --slug transcript-foj-12 --pubdate 2026-11-15 \
    --guid <episode-guid> --no-push
# -> public/podcast/transcript-foj-12.html (review, then commit/push)
```

Use `--pause-gap 1.4` for whisper timings (they run wider than
AssemblyAI's; its default is 1.2). First run downloads a ~1.6GB model;
a 40-minute sermon transcribes in ~2.5 minutes on Apple Silicon.

## The paid flow (AssemblyAI)

```bash
export ASSEMBLYAI_API_KEY='...'
./scripts/transcripts/add-transcript.sh --audio-url "https://.../sermon.mp3" \
    --title "Acts 21:1-14" [...]
```

Uses `universal-3-5-pro` with speaker labels and biblical keyterms. Other
useful flags: `--transcript-id` (reuse a completed transcript),
`--transcript-file` (skip transcription with local text), `--no-push`
(write HTML only, print the git commands), `--placeholder` (stub page).

## Files

| File | What it does |
|---|---|
| `add-transcript.sh` | The pipeline: transcript in, HTML page out. Auto-commits the page, this folder's manifest entry, and pushes to main (unless `--no-push`). |
| `transcribe-local.sh` | Audio URL/file in, `sermon.txt + sermon.words.json` out (model download, `whisper-cli --split-on-word`, word timings). |
| `whisper-words.py` | Converts whisper.cpp `--output-json-full` output to the `--transcript-words` format (`[{t, start, end}]` seconds). Stdlib only. |

## What a run produces and touches

- `public/sermons/transcript-<slug>.html` (sermon) or
  `public/podcast/transcript-<slug>.html` (podcast) — the page: header, audio
  player, read-along transcript (timed sentence spans when word timings
  exist, plain paragraphs otherwise).
- `public/transcripts.json` — episode-guid → transcript-path manifest;
  `/sermons` and `/podcast` both link titles from this same manifest. Updated automatically by
  `add-transcript.sh`.
- `public/readalong.{css,js}` — shared read-along layer (sticky
  mini-player, sentence highlight, auto-follow). Bump `?v=` in these
  files, the transcript pages, and the `add-transcript.sh` template
  together when changing them.

## What differs per kind (`--kind podcast`)

- Template: `public/podcast.html` instead of `public/sermons.html`
  (override with `--template`/`TEMPLATE`).
- Output dir: `--slug X` writes `public/podcast/X.html` instead of
  `public/sermons/X.html` (explicit `--output` still wins over everything).
- Back link: `← All podcast episodes` (`/podcast`) instead of
  `← All sermons` (override with `--back-link`/`--back-label`).
- `<title>`: `<Title> — Podcast Transcript — …` instead of `Sermon Transcript`.
- Commit message: `Add podcast transcript: <TITLE>`; share path `/podcast/<slug>`.
- AssemblyAI keyterms: generic list (`Jesus`, `Bible`, `faith`,
  `church`, `Gospel`) instead of the Acts list (`KEYTERMS="a,b,c"` env
  overrides either).
- Speaker/series default to empty for podcast (sermon keeps
  `Rich Richardson` / `Acts`); the meta line already skips empties.

## Conventions

- Slugs: `transcript-<book>-<chapter>-<verses>`, e.g.
  `transcript-acts-20-1-12`. Titles match the feed (`Acts 20:1-12`).
- Stays in dark mode: transcript pages follow the device preference via
  page-inline CSS, except the header/menu which is pinned light.
- Paragraphing breaks on pauses over `PAUSE_GAP` seconds (1.2
  AssemblyAI, 1.4 whisper), with sentence/word-count backstops.
