#!/usr/bin/env bash
# Add an unlinked sermon-transcript static page.
#
# Default targets last week's sermon (Acts 20:13-38, 2026-11-08).
# Override any field via env vars or CLI flags for future sermons:
#
#   AUDIO_URL TITLE SPEAKER SERIES DESCRIPTION PUBDATE DURATION GUID SLUG OUTPUT TRANSCRIPT_FILE TRANSCRIPT_ID PAUSE_GAP
#
# Examples:
#   ./scripts/transcripts/add-transcript.sh
#   AUDIO_URL="https://.../sermon.mp3" TITLE="Acts 21:1-14" ./scripts/transcripts/add-transcript.sh
#   ./scripts/transcripts/add-transcript.sh --audio-url https://.../x.mp3 --title "Acts 21:1-14" \
#     --speaker "Rich Richardson" --series Acts --pubdate 2026-11-15 --slug transcript-acts-21-1-14
#   ./scripts/transcripts/add-transcript.sh --transcript-id 098422e6-80de-420f-ad1c-d0fec7462169  # reuse completed transcript, no re-transcribe
#   ./scripts/transcripts/add-transcript.sh --transcript-file /tmp/sermon.txt   # skip AssemblyAI, use local text
#   ./scripts/transcripts/add-transcript.sh --transcript-file /tmp/sermon.txt --transcript-words /tmp/words.json  # local text + word timings
#
# Local whisper.cpp flow (free, no API key):
#   ./scripts/transcripts/transcribe-local.sh "https://.../sermon.mp3" sermon
#   ./scripts/transcripts/add-transcript.sh --transcript-file sermon.txt \
#       --transcript-words sermon.words.json --pause-gap 1.4 [other flags]
# (whisper timings run wider than AssemblyAI's, so use --pause-gap 1.4.)
#   ./scripts/transcripts/add-transcript.sh --no-push                            # write HTML only, print manual git commands
#   ./scripts/transcripts/add-transcript.sh --message "Custom commit msg"        # override commit message
#   ./scripts/transcripts/add-transcript.sh --pause-gap 1.5                  # pause threshold (s) for paragraph breaks, default 1.2
#
# Chunking is pause-based when word timestamps exist: a new paragraph starts
# wherever the gap between consecutive words exceeds PAUSE_GAP seconds, with
# the existing ~150-200 word / 6-10 sentence caps and speaker-change breaks as
# backstops. Plain-text input (no timings) falls back to sentence-chunking.
#
# After writing the HTML the script auto-commits (message
# "Add sermon transcript: <TITLE>") and pushes to main, unless --no-push.
#   ./scripts/transcripts/add-transcript.sh --placeholder                          # placeholder page, no API call
#
# Deps: bash, curl, python3 (stdlib only). No npm.
set -euo pipefail

TITLE="${TITLE:-Acts 20:13-38}"
PUBDATE="${PUBDATE:-2026-11-08}"
GUID="${GUID:-3f955c89-554b-49d8-ad2f-70bd95322810}"
AUDIO_URL="${AUDIO_URL:-https://d3ctxlq1ktw2nl.cloudfront.net/staging/2026-10-8/6380d55e-b173-d3e1-8e8f-485108363255.mp3}"
DURATION="${DURATION:-00:38:30}"
DESCRIPTION="${DESCRIPTION:-What is a pastor and what does he do?}"
SPEAKER="${SPEAKER:-Rich Richardson}"
SERIES="${SERIES:-Acts}"
SLUG="${SLUG:-transcript-acts-20-13-38}"
OUTPUT="${OUTPUT:-public/sermons/${SLUG}.html}"
TRANSCRIPT_FILE="${TRANSCRIPT_FILE:-}"
TRANSCRIPT_ID="${TRANSCRIPT_ID:-}"
MESSAGE="${MESSAGE:-}"
PAUSE_GAP="${PAUSE_GAP:-1.2}"
NO_PUSH=0
PLACEHOLDER=0

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed 's/^# \?//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --audio-url)       AUDIO_URL="$2"; shift 2 ;;
    --title)           TITLE="$2"; shift 2 ;;
    --speaker)         SPEAKER="$2"; shift 2 ;;
    --series)          SERIES="$2"; shift 2 ;;
    --description)     DESCRIPTION="$2"; shift 2 ;;
    --pubdate|--date)  PUBDATE="$2"; shift 2 ;;
    --duration)        DURATION="$2"; shift 2 ;;
    --guid)            GUID="$2"; shift 2 ;;
    --slug)            SLUG="$2"; OUTPUT="public/sermons/$2.html"; shift 2 ;;
    --output|--out)    OUTPUT="$2"; shift 2 ;;
    --transcript-file) TRANSCRIPT_FILE="$2"; shift 2 ;;
    --transcript-words) TRANSCRIPT_WORDS="$2"; TRANSCRIPT_WORDS_GIVEN=1; shift 2 ;;
    --transcript-id)   TRANSCRIPT_ID="$2"; shift 2 ;;
    --message)         MESSAGE="$2"; shift 2 ;;
    --no-push)         NO_PUSH=1; shift ;;
    --pause-gap)       PAUSE_GAP="$2"; shift 2 ;;
    --placeholder)     PLACEHOLDER=1; shift ;;
    -h|--help)         usage; exit 0 ;;
    *) echo "Unknown arg: $1 (see --help)" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
TEMPLATE="public/sermons.html"
[ -f "$TEMPLATE" ] || { echo "Template not found: $TEMPLATE" >&2; exit 1; }

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
TRANSCRIPT_TXT="$TMPDIR/transcript.txt"
TRANSCRIPT_WORDS_GIVEN="${TRANSCRIPT_WORDS_GIVEN:-0}"
if [ -z "${TRANSCRIPT_WORDS:-}" ]; then
  TRANSCRIPT_WORDS="$TMPDIR/words.json"
  : > "$TRANSCRIPT_WORDS"  # render_json fills this when word timings exist
elif [ "$TRANSCRIPT_WORDS_GIVEN" -eq 1 ]; then
  [ -f "$TRANSCRIPT_WORDS" ] || { echo "Not found: $TRANSCRIPT_WORDS" >&2; exit 1; }
fi

write_placeholder() {
  cat > "$TRANSCRIPT_TXT" <<'EOF'
[TRANSCRIPT PLACEHOLDER — re-run scripts/transcripts/add-transcript.sh with $ASSEMBLYAI_API_KEY set to fill this in.]

The audio for this sermon is available above. The full transcript will appear here once generated.
EOF
}

if [ "$PLACEHOLDER" -eq 1 ]; then
  echo "Writing placeholder transcript (no API call)."
  write_placeholder
elif [ -n "$TRANSCRIPT_FILE" ]; then
  [ -f "$TRANSCRIPT_FILE" ] || { echo "Not found: $TRANSCRIPT_FILE" >&2; exit 1; }
  cp "$TRANSCRIPT_FILE" "$TRANSCRIPT_TXT"
  echo "Using local transcript: $TRANSCRIPT_FILE"
else
  if [ -z "${ASSEMBLYAI_API_KEY:-}" ]; then
    echo "ERROR: \$ASSEMBLYAI_API_KEY is not set." >&2
    echo "Sign up free (\$50 credits, no card): https://assemblyai.com/dashboard/signup" >&2
    echo "Then: export ASSEMBLYAI_API_KEY='your-key' && $0" >&2
    echo "Or generate the placeholder page now: $0 --placeholder" >&2
    exit 1
  fi

  # Transcript JSON (completed) -> plain text file + word timings JSON.
  # Single-speaker audio collapses to one text stream (speaker-grouping would
  # yield a single giant paragraph); pause-based chunking into readable <p>s
  # happens at render time. [Speaker X] prefixes are kept only where
  # diarization actually switches speakers.
  render_json() {
    python3 - "$1" "$TRANSCRIPT_TXT" "$TRANSCRIPT_WORDS" <<'EOF'
import json, sys
data = json.load(open(sys.argv[1]))
out_path, words_path = sys.argv[2], sys.argv[3]
utterances = data.get("utterances") or []
if utterances:
    multi = len({u.get("speaker") for u in utterances}) > 1
    turns, cur_spk, buf = [], None, []
    for u in utterances:
        spk = u.get("speaker", "?")
        txt = (u.get("text") or "").strip()
        if not txt:
            continue
        if spk != cur_spk:
            if buf:
                turns.append((cur_spk, " ".join(buf)))
            cur_spk, buf = spk, []
        buf.append(txt)
    if buf:
        turns.append((cur_spk, " ".join(buf)))
    if multi:
        text = "\n\n".join("[Speaker %s] %s" % (s, t) for s, t in turns)
    else:
        text = " ".join(t for _, t in turns)
else:
    text = (data.get("text") or "").strip()
with open(out_path, "w") as f:
    f.write(text.strip() + "\n" if text.strip() else "")
# Preserve word-level timings (ms -> s) for pause-based chunking.
words = data.get("words") or []
if not words:
    for u in utterances:
        words.extend(u.get("words") or [])
timed = [{"t": w.get("text", ""), "start": (w.get("start") or 0) / 1000.0,
          "end": (w.get("end") or 0) / 1000.0, "speaker": w.get("speaker")}
         for w in words if w.get("text")]
with open(words_path, "w") as f:
    json.dump(timed, f)
EOF
  }

  if [ -n "$TRANSCRIPT_ID" ]; then
    echo "Fetching completed transcript ${TRANSCRIPT_ID} (no re-transcribe)..."
    TJ="$TMPDIR/transcript.json"
    curl -sS "https://api.assemblyai.com/v2/transcript/${TRANSCRIPT_ID}" \
      -H "authorization: ${ASSEMBLYAI_API_KEY}" -o "$TJ"
    STATUS="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status",""))' "$TJ")"
    [ "$STATUS" = "completed" ] || { echo "Transcript status is '$STATUS' (need 'completed')." >&2; exit 1; }
    render_json "$TJ"
  else

  echo "Submitting to AssemblyAI (model universal-3-5-pro)..."
  SUBMIT_RESP="$TMPDIR/submit.json"
  python3 - "$AUDIO_URL" "$SUBMIT_RESP" <<'EOF'
import json, sys
audio_url, out = sys.argv[1], sys.argv[2]
body = {
    "audio_url": audio_url,
    "speech_model": "universal-3-5-pro",
    "speaker_labels": True,
    "keyterms_prompt": ["Acts", "Paul", "Ephesus", "Miletus", "Holy Spirit",
                        "elders", "overseers", "shepherd", "pastor",
                        "Troas", "Assos", "Mitylene", "Luke"],
}
with open(out, "w") as f:
    json.dump(body, f)
EOF
  SUBMIT_OUT="$TMPDIR/submit_out.json"
  curl -sS -X POST "https://api.assemblyai.com/v2/transcript" \
    -H "authorization: ${ASSEMBLYAI_API_KEY}" \
    -H "content-type: application/json" \
    --data @"$SUBMIT_RESP" -o "$SUBMIT_OUT"
  TID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("id",""))' "$SUBMIT_OUT")"
  [ -n "$TID" ] || { echo "Submit failed:" >&2; cat "$SUBMIT_OUT" >&2; exit 1; }
  echo "Transcript id: $TID — polling..."

  for _ in $(seq 1 180); do
    sleep 10
    POLL="$TMPDIR/poll.json"
    curl -sS "https://api.assemblyai.com/v2/transcript/${TID}" \
      -H "authorization: ${ASSEMBLYAI_API_KEY}" -o "$POLL"
    STATUS="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status",""))' "$POLL")"
    echo "  status: $STATUS"
    case "$STATUS" in
      completed)
        render_json "$POLL"
        break
        ;;
      error)
        python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("error","unknown error"))' "$POLL" >&2
        exit 1
        ;;
      queued|processing) ;;
      *) echo "Unexpected status: $STATUS" >&2; cat "$POLL" >&2; exit 1 ;;
    esac
  done
  fi
  [ -s "$TRANSCRIPT_TXT" ] || { echo "Timed out waiting for transcript." >&2; exit 1; }
  echo "Transcript saved ($(wc -w < "$TRANSCRIPT_TXT") words)."
fi

mkdir -p "$(dirname "$OUTPUT")"
export TITLE PUBDATE GUID AUDIO_URL DURATION DESCRIPTION SPEAKER SERIES TRANSCRIPT_TXT OUTPUT TEMPLATE TRANSCRIPT_WORDS PAUSE_GAP
python3 <<'EOF'
import html, json, os, re

SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=(?:\[Speaker [^\]]+\]\s*)?[A-Z0-9\"'])")
SPEAKER_RE = re.compile(r"^\[Speaker ([^\]]+)\]\s*")

def normtok(s):
    return re.sub(r"[^\w']", "", s, flags=re.UNICODE).lower()

def split_sentences(text):
    """Flatten text into (speaker_or_None, sentence) pairs."""
    out, cur_spk = [], None
    for part in SENT_SPLIT.split(text):
        m = SPEAKER_RE.match(part)
        if m:
            cur_spk = m.group(1)
            part = part[m.end():]
        part = part.strip()
        if part:
            out.append((cur_spk, part))
    return out

def pause_gaps(sentences, timed):
    """Align sentences to word timings; return gap-before (seconds) per
    sentence, None where unknown. Pauses snap to sentence boundaries."""
    gaps = [None] * len(sentences)
    if not timed:
        return gaps
    toks = [[t for t in (normtok(w) for w in s.split()) if t] for _, s in sentences]
    p, prev_end, n = 0, None, len(timed)
    for i, ts in enumerate(toks):
        if not ts:
            continue
        nxt = next((toks[j][0] for j in range(i + 1, len(toks)) if toks[j]), None)
        first_start, last_end, taken = None, None, 0
        while p < n and taken < len(ts):
            w = timed[p]
            p += 1
            if first_start is None:
                first_start = w.get("start")
            last_end = w.get("end")
            if not normtok(w.get("t", "")):
                continue
            taken += 1
            if (taken >= len(ts) - 1 and nxt and p < n
                    and normtok(timed[p].get("t", "")) == nxt):
                break
        if first_start is not None and prev_end is not None:
            gaps[i] = first_start - prev_end
        if last_end is not None:
            prev_end = last_end
    return gaps

def sentence_bounds(sentences, timed):
    """Per-sentence (start,end) seconds from word timings; (0.0,0.0) where
    unknown. Same alignment walk as pause_gaps."""
    toks = [[t for t in (normtok(w) for w in s.split()) if t] for _, s in sentences]
    p, prev_end, n = 0, None, len(timed)
    bounds = []
    for i, ts in enumerate(toks):
        first_start, last_end, taken = None, None, 0
        if not ts:
            bounds.append((0.0, 0.0))
            continue
        nxt = next((toks[j][0] for j in range(i + 1, len(toks)) if toks[j]), None)
        while p < n and taken < len(ts):
            w = timed[p]
            p += 1
            if first_start is None and w.get("start") is not None:
                first_start = w.get("start")
            if w.get("end") is not None:
                last_end = w.get("end")
            if not normtok(w.get("t", "")):
                continue
            taken += 1
            if (taken >= len(ts) - 1 and nxt and p < n
                    and normtok(timed[p].get("t", "")) == nxt):
                break
        s = first_start if first_start is not None else (prev_end if prev_end is not None else 0.0)
        e = last_end if last_end is not None else s
        bounds.append((s, e))
        if last_end is not None:
            prev_end = last_end
    return bounds

def chunk_paragraphs(text, timed, pause_gap):
    """Pause-based chunking: a new paragraph starts wherever the inter-word
    gap exceeds pause_gap seconds. Backstops: ~6-10 sentences or ~150-200
    words (whichever first), plus speaker-change breaks. Without timings,
    falls back to pure sentence-chunking."""
    sentences = split_sentences(text)
    multi = len({s for s, _ in sentences if s}) > 1
    gaps = pause_gaps(sentences, timed)
    grouped, cur, words, cur_spk = [], [], 0, None
    for idx, (spk, sent) in enumerate(sentences):
        gap = gaps[idx]
        if cur and (spk != cur_spk
                     or (gap is not None and gap > pause_gap)
                     or (len(cur) >= 6 and words >= 150)
                     or len(cur) >= 10 or words >= 200):
            grouped.append((cur_spk, cur))
            cur, words = [], 0
        if not cur:
            cur_spk = spk
        cur.append(sent)
        words += len(sent.split())
    if cur:
        grouped.append((cur_spk, cur))
    # Fold a tiny trailing tail into the previous paragraph (same speaker only).
    if (len(grouped) > 1 and grouped[-1][0] == grouped[-2][0]
            and len(grouped[-1][1]) < 3
            and sum(len(s.split()) for s in grouped[-1][1]) < 80):
        grouped[-2] = (grouped[-2][0], grouped[-2][1] + grouped[-1][1])
        grouped.pop()
    paras, prev = [], None
    for spk, sents in grouped:
        prefix = "[Speaker %s] " % spk if (multi and spk and spk != prev) else ""
        paras.append(prefix + " ".join(sents))
        prev = spk
    return paras

tpl = open(os.environ["TEMPLATE"]).read()
title = os.environ["TITLE"]; speaker = os.environ["SPEAKER"]
series = os.environ["SERIES"]; desc = os.environ["DESCRIPTION"]
pubdate = os.environ["PUBDATE"]; duration = os.environ["DURATION"]
audio = os.environ["AUDIO_URL"]; guid = os.environ["GUID"]
raw = open(os.environ["TRANSCRIPT_TXT"]).read().strip()

placeholder = "TRANSCRIPT PLACEHOLDER" in raw
paras = [p.strip() for p in re.split(r"\n\s*\n", raw) if p.strip()]
timed = []  # word timings when available; [] = plain paragraphs, read-along idle
if not placeholder:
    # Pause-based chunking when word timings exist (falls back to pure
    # sentence-chunking for plain-text input).
    try:
        pause_gap = float(os.environ.get("PAUSE_GAP", "1.2"))
    except ValueError:
        pause_gap = 1.2
    timed = []
    words_path = os.environ.get("TRANSCRIPT_WORDS", "")
    if words_path and os.path.exists(words_path):
        try:
            timed = json.load(open(words_path))
        except (ValueError, OSError):
            timed = []
    text = " ".join(paras)
    # Collapse all runs of whitespace (including single newlines from
    # line-per-segment transcript files) so no literal newlines survive
    # inside <p>s — the transcript div uses white-space:pre-line, which
    # would otherwise render each one as a forced line break.
    text = re.sub(r"\s+", " ", text).strip()
    paras = chunk_paragraphs(text, timed, pause_gap)
if timed:
    # Read-along: wrap each sentence in a timed span. Duplicate sentences
    # consume their bounds in order, so alignment holds.
    sent_list = split_sentences(text)
    bnds = sentence_bounds(sent_list, timed)
    bmap = {}
    for (spk, sent), (s, e) in zip(sent_list, bnds):
        bmap.setdefault(sent, []).append((s, e))
    def spanify(para):
        parts = []
        for spk, sent in split_sentences(para):
            lst = bmap.get(sent) or [(0.0, 0.0)]
            s, e = lst.pop(0)
            parts.append('<span class="tl-s" data-s="%.2f" data-e="%.2f">%s</span>'
                         % (s, e, html.escape(sent)))
        return " ".join(parts)
    body_html = "\n".join("        <p>%s</p>" % spanify(p) for p in paras) or "        <p>(Empty transcript.)</p>"
else:
    # No timings (plain-text input): plain paragraphs, read-along JS stays idle.
    body_html = "\n".join("        <p>%s</p>" % html.escape(p) for p in paras) or "        <p>(Empty transcript.)</p>"
notice = ""
if placeholder:
    notice = ('        <p class="transcript-notice"><strong>Note:</strong> this is a placeholder transcript. '
              'Re-run <code>scripts/transcripts/add-transcript.sh</code> with <code>$ASSEMBLYAI_API_KEY</code> set '
              'to generate the full transcript.</p>\n')

meta_bits = " · ".join(b for b in [speaker, series, pubdate, duration] if b)

main = """  <main>
    <section class="section">
      <div class="container">
        <div class="transcript-head">
          <a class="transcript-back" href="/sermons">&larr; All sermons</a>
          <h1 class="display-lg">%s</h1>
          <p class="transcript-meta">%s</p>
          <p class="transcript-desc">%s</p>
          <div class="sermon">
            <audio controls preload="none" src="%s"></audio>
          </div>
        </div>
        <h2 class="display-lg" style="margin-top:2rem">Transcript</h2>
        <div class="transcript" style="white-space:pre-line">
%s%s
        </div>
      </div>
    </section>
  </main>""" % (html.escape(title), html.escape(meta_bits),
               html.escape(desc), html.escape(audio, quote=True),
               notice, body_html)

new = re.sub(r"<main>.*?</main>", lambda _: main, tpl, count=1, flags=re.DOTALL)
new = new.replace("<title>Sermons — Center Church Gilbert</title>",
                  "<title>%s — Sermon Transcript — Center Church Gilbert</title>" % html.escape(title))
# Transcript dark mode: device preference only, no toggle. Inline in <head>
# so only transcript pages are affected — the rest of the site keeps its
# light theme and styles.css stays untouched.
dark_style = """  <style>
    /* Sermon transcript dark mode: follows the device preference only.
       Inline here so only transcript pages are affected; the rest of the
       site keeps its light theme. No toggle, no JS. */
    /* Transcript header: calm type-led top (no photo hero). Single
       title (page h1, read by the read-along mini-bar) and meta
       line, then the description and the audio player grouped as the
       .sermon unit below. */
    .transcript-head { display: flex; flex-direction: column; align-items: flex-start; margin-bottom: 1.75rem; }
    .transcript-head h1 { margin-bottom: 0.6rem; }
    .transcript-back { display: inline-block; margin-bottom: 1.25rem; font-weight: 700; font-size: 0.95rem; color: var(--clay-dark); text-decoration: none; }
    .transcript-back:hover { text-decoration: underline; }
    .transcript-meta { color: var(--muted); font-weight: 600; font-size: 0.95rem; }
    .transcript-desc { color: var(--muted); font-size: 1rem; margin: 0.75rem 0 0; max-width: 38rem; }
    .transcript-head .sermon { width: 100%; box-sizing: border-box; margin-top: 1.25rem; }
    .transcript-head .sermon audio { margin-top: 0; }
    @media (prefers-color-scheme: dark) {
      .transcript-back { color: #e8a76f; }
      .transcript-meta { color: var(--muted-dark); }
      .transcript-desc { color: var(--muted-dark); }
      body { background: var(--ink); color: var(--cream); }
      /* Header stays light in dark mode: pin to the light-theme values
         from styles.css so the bar, nav, dropdowns, and mobile menu
         never go dark. */
      .site-header { background: rgba(250, 246, 239, 0.92); border-bottom-color: var(--line); }
      .brand-logo-dark { filter: invert(1); }
      .nav-links a { color: var(--ink); }
      .nav-links a:hover, .nav-links a.active { color: var(--clay-dark); }
      .dropdown { background: #fff; border: 1px solid var(--line); border-top: 0.9rem solid transparent; background-clip: padding-box; }
      .dropdown a { color: var(--ink); }
      .dropdown a:hover { background: var(--cream-2); color: var(--ink); }
      .dropdown a.active { color: var(--clay-dark); background: var(--cream-2); }
      .hamburger { color: var(--ink); border-color: var(--line); background: none; }
      .mobile-menu { background: var(--cream); color: var(--ink); border-top-color: var(--line); }
      .mobile-menu details { border-color: var(--line); }
      .mobile-menu summary { color: var(--ink); }
      .mobile-menu summary::after { color: var(--clay-dark); }
      .mobile-menu details a, .mobile-menu > a.mobile-login { color: var(--ink); }
      .sermon { background: var(--ink-2); border-color: var(--line-light); }
      .sermon .meta { color: var(--muted-dark); }
      .sermon audio { border-radius: 12px; background: #100d0a; }
      .transcript p { color: #ece1d1; }
      .transcript-notice { background: rgba(232, 167, 111, 0.1); border: 1px solid var(--line-light); border-radius: 12px; padding: 1rem 1.2rem; }
      .transcript code { background: #100d0a; color: #e8a76f; border: 1px solid var(--line-light); border-radius: 6px; padding: 0.1em 0.35em; }
    }
  </style>"""
new = new.replace("</head>", dark_style + "\n</head>", 1)

# Read-along audio (sticky mini player, sentence highlight, auto-follow).
# Shared files — bump ?v= in public/readalong.css, public/readalong.js, AND
# here together so browsers pick up changes. Page-specific copy
# (transcript-acts-20-13-38) links the same files. The mini-bar label is
# read from the page h1 by the shared JS. Without word timings the JS finds
# no .tl-s nodes and stays idle (the sticky player bar still works).
new = new.replace("</head>", '  <link rel="stylesheet" href="/readalong.css?v=1" />\n</head>', 1)
new = new.replace("</body>", '  <script src="/readalong.js?v=1"></script>\n</body>', 1)
if "<!-- guid: " not in new:
    new = new.replace("</body>", "<!-- guid: %s -->\n</body>" % html.escape(guid))

with open(os.environ["OUTPUT"], "w") as f:
    f.write(new)
print("Wrote %s" % os.environ["OUTPUT"])
EOF

if [ "$NO_PUSH" -eq 0 ]; then
# Maintain the transcript manifest consulted by /sermons (guid -> path).
# Only on real runs: --no-push is a side-effect-free dry run.
python3 - "$GUID" "/sermons/${SLUG}" <<'EOF'
import json, sys
p = "public/transcripts.json"
try:
    m = json.load(open(p))
except (ValueError, OSError):
    m = {}
m[sys.argv[1]] = sys.argv[2]
with open(p, "w") as f:
    json.dump(m, f, indent=2, sort_keys=True)
    f.write("\n")
print("Manifest %s: %s -> %s" % (p, sys.argv[1], sys.argv[2]))
EOF
fi

echo
MSG="${MESSAGE:-Add sermon transcript: ${TITLE}}"
if [ "$NO_PUSH" -eq 1 ]; then
  echo "Next steps (--no-push: commit+push skipped):"
  echo "  1. Review ${OUTPUT} in a browser (unlinked draft — not in nav or sitemap)."
  echo "  2. git add ${OUTPUT} scripts/transcripts/add-transcript.sh public/transcripts.json && git commit -m \"${MSG}\" && git push"
  echo "     (push to main deploys via the existing GitHub Action)"
  echo "  3. Share the direct URL path: /sermons/${SLUG}"
else
  # Stage ONLY these three paths — never `git add -A`. Unrelated dirty files
  # (staged or not) are left untouched.
  git add -- "${OUTPUT}" scripts/transcripts/add-transcript.sh public/transcripts.json
  if git diff --cached --quiet -- "${OUTPUT}" scripts/transcripts/add-transcript.sh public/transcripts.json; then
    echo "Nothing new to commit (${OUTPUT} and script unchanged)."
  else
    git commit -m "${MSG}" -- "${OUTPUT}" scripts/transcripts/add-transcript.sh
    if git push; then
      echo "Pushed to main (deploys via the existing GitHub Action)."
    else
      echo "ERROR: git push failed. Retry manually: git push" >&2
      exit 1
    fi
  fi
  echo "Done. Review ${OUTPUT} in a browser (unlinked draft — not in nav or sitemap)."
  echo "Share the direct URL path: /sermons/${SLUG}"
fi
