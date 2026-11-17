#!/usr/bin/env bash
# Add an unlinked sermon- or podcast-transcript static page.
#
# Default targets last week's sermon (Acts 20:13-38, 2026-11-08).
# KIND selects sermon (default) or podcast; it switches the template,
# output dir, back link, <title>, manifest path, and AssemblyAI keyterms.
# Override any field via env vars or CLI flags for future episodes:
#
#   AUDIO_URL TITLE SPEAKER SERIES DESCRIPTION PUBDATE DURATION GUID SLUG OUTPUT TRANSCRIPT_FILE TRANSCRIPT_ID PAUSE_GAP
#   KIND TEMPLATE BACK_LINK BACK_LABEL KEYTERMS
#
# Examples:
#   ./scripts/transcripts/add-transcript.sh
#   AUDIO_URL="https://.../sermon.mp3" TITLE="Acts 21:1-14" ./scripts/transcripts/add-transcript.sh
#   ./scripts/transcripts/add-transcript.sh --audio-url https://.../x.mp3 --title "Acts 21:1-14" \
#     --speaker "Rich Richardson" --series Acts --pubdate 2026-11-15 --slug transcript-acts-21-1-14
#   ./scripts/transcripts/add-transcript.sh --kind podcast --slug transcript-foj-42 --title "Episode 42 Title" \
#     --audio-url https://.../ep.mp3 --pubdate 2026-11-15 --guid <episode-guid> --placeholder --no-push
#   ./scripts/transcripts/add-transcript.sh --transcript-id 098422e6-80de-420f-ad1c-d0fec7462169  # reuse completed transcript, no re-transcribe
#   ./scripts/transcripts/add-transcript.sh --transcript-file /tmp/sermon.txt   # skip AssemblyAI, use local text
#   ./scripts/transcripts/add-transcript.sh --transcript-file /tmp/sermon.txt --transcript-words /tmp/words.json  # local text + word timings
#
# Local whisper.cpp flow (free, no API key):
#   ./scripts/transcripts/transcribe-local.sh "https://.../sermon.mp3" sermon
#   ./scripts/transcripts/add-transcript.sh --transcript-file sermon.txt \
#       --transcript-words sermon.words.json --pause-gap 1.4 [other flags]
# (whisper timings run wider than AssemblyAI's, so use --pause-gap 1.4.)
#   ./scripts/transcripts/add-transcript.sh --kind podcast --transcript-id <id> \
#       --speaker-map "A=Rich Richardson,B=Mark Johnson Jr."  # name diarized voices (SPEAKER_MAP env)
#   ./scripts/transcripts/add-transcript.sh --no-push                            # write HTML only, print manual git commands
#   ./scripts/transcripts/add-transcript.sh --message "Custom commit msg"        # override commit message
#   ./scripts/transcripts/add-transcript.sh --pause-gap 1.5                  # pause threshold (s) for paragraph breaks, default 1.2
#   ./scripts/transcripts/add-transcript.sh --kind sermon|podcast            # or KIND=podcast; --type is an alias
#   ./scripts/transcripts/add-transcript.sh --template public/podcast.html   # or TEMPLATE env; default follows KIND
#   ./scripts/transcripts/add-transcript.sh --back-link /podcast --back-label "All podcast episodes"  # or BACK_LINK/BACK_LABEL env
# KEYTERMS env (comma-separated) overrides the AssemblyAI keyterms list.
#
# Chunking is pause-based when word timestamps exist: a new paragraph starts
# wherever the gap between consecutive words exceeds PAUSE_GAP seconds, with
# the existing ~150-200 word / 6-10 sentence caps and speaker-change breaks as
# backstops. Plain-text input (no timings) falls back to sentence-chunking.
#
# After writing the HTML the script auto-commits (message
# "Add <kind> transcript: <TITLE>") and pushes to main, unless --no-push.
#   ./scripts/transcripts/add-transcript.sh --placeholder                          # placeholder page, no API call
#
# Deps: bash, curl, python3 (stdlib only). No npm.
set -euo pipefail

KIND="${KIND:-sermon}"
# Track explicitly-provided values (env or flag) so KIND defaults only
# fill in what the caller left unset; explicit empty still counts as given.
SERIES_GIVEN=0; SPEAKER_GIVEN=0; TEMPLATE_GIVEN=0; OUTPUT_GIVEN=0
OUTPUT_FLAG=0; SLUG_GIVEN=0; SLUG_FLAG=0; BACK_LINK_GIVEN=0; BACK_LABEL_GIVEN=0
[ -n "${SERIES+x}" ] && SERIES_GIVEN=1
[ -n "${SPEAKER+x}" ] && SPEAKER_GIVEN=1
[ -n "${TEMPLATE+x}" ] && TEMPLATE_GIVEN=1
[ -n "${OUTPUT+x}" ] && OUTPUT_GIVEN=1
[ -n "${SLUG+x}" ] && SLUG_GIVEN=1
[ -n "${BACK_LINK+x}" ] && BACK_LINK_GIVEN=1
[ -n "${BACK_LABEL+x}" ] && BACK_LABEL_GIVEN=1

TITLE="${TITLE:-Acts 20:13-38}"
PUBDATE="${PUBDATE:-2026-11-08}"
GUID="${GUID:-3f955c89-554b-49d8-ad2f-70bd95322810}"
AUDIO_URL="${AUDIO_URL:-https://d3ctxlq1ktw2nl.cloudfront.net/staging/2026-10-8/6380d55e-b173-d3e1-8e8f-485108363255.mp3}"
DURATION="${DURATION:-00:38:30}"
DESCRIPTION="${DESCRIPTION:-What is a pastor and what does he do?}"
SPEAKER="${SPEAKER:-}"
SERIES="${SERIES:-}"
SLUG="${SLUG:-transcript-acts-20-13-38}"
OUTPUT="${OUTPUT:-}"
TEMPLATE="${TEMPLATE:-}"
BACK_LINK="${BACK_LINK:-}"
BACK_LABEL="${BACK_LABEL:-}"
KEYTERMS="${KEYTERMS:-}"
TRANSCRIPT_FILE="${TRANSCRIPT_FILE:-}"
TRANSCRIPT_ID="${TRANSCRIPT_ID:-}"
SPEAKER_MAP="${SPEAKER_MAP:-}"
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
    --speaker)         SPEAKER="$2"; SPEAKER_GIVEN=1; shift 2 ;;
    --series)          SERIES="$2"; SERIES_GIVEN=1; shift 2 ;;
    --description)     DESCRIPTION="$2"; shift 2 ;;
    --pubdate|--date)  PUBDATE="$2"; shift 2 ;;
    --duration)        DURATION="$2"; shift 2 ;;
    --guid)            GUID="$2"; shift 2 ;;
    --slug)            SLUG="$2"; SLUG_GIVEN=1; SLUG_FLAG=1; shift 2 ;;
    --output|--out)    OUTPUT="$2"; OUTPUT_GIVEN=1; OUTPUT_FLAG=1; shift 2 ;;
    --kind|--type)
      KIND="$2"; shift 2 ;;
    --template)        TEMPLATE="$2"; TEMPLATE_GIVEN=1; shift 2 ;;
    --back-link)       BACK_LINK="$2"; BACK_LINK_GIVEN=1; shift 2 ;;
    --back-label)      BACK_LABEL="$2"; BACK_LABEL_GIVEN=1; shift 2 ;;
    --transcript-file) TRANSCRIPT_FILE="$2"; shift 2 ;;
    --transcript-words) TRANSCRIPT_WORDS="$2"; TRANSCRIPT_WORDS_GIVEN=1; shift 2 ;;
    --transcript-id)   TRANSCRIPT_ID="$2"; shift 2 ;;
    --speaker-map)     SPEAKER_MAP="$2"; shift 2 ;;
    --message)         MESSAGE="$2"; shift 2 ;;
    --no-push)         NO_PUSH=1; shift ;;
    --pause-gap)       PAUSE_GAP="$2"; shift 2 ;;
    --placeholder)     PLACEHOLDER=1; shift ;;
    -h|--help)         usage; exit 0 ;;
    *) echo "Unknown arg: $1 (see --help)" >&2; exit 1 ;;
  esac
done

case "$KIND" in
  sermon|podcast) ;;
  *) echo "Unknown --kind: $KIND (want sermon|podcast)" >&2; exit 1 ;;
esac

# KIND-derived defaults (only where the caller gave nothing explicitly).
if [ "$KIND" = "podcast" ]; then
  KIND_DIR="public/podcast"; SHARE_DIR="/podcast"
  KIND_TITLE="Podcast"; NOUN="episode"
  [ "$TEMPLATE_GIVEN" -eq 0 ] && TEMPLATE="public/podcast.html"
  [ "$BACK_LINK_GIVEN" -eq 0 ] && BACK_LINK="/podcast"
  [ "$BACK_LABEL_GIVEN" -eq 0 ] && BACK_LABEL="All podcast episodes"
else
  KIND_DIR="public/sermons"; SHARE_DIR="/sermons"
  KIND_TITLE="Sermon"; NOUN="sermon"
  [ "$SERIES_GIVEN" -eq 0 ] && SERIES="Acts"
  [ "$SPEAKER_GIVEN" -eq 0 ] && SPEAKER="Rich Richardson"
  [ "$TEMPLATE_GIVEN" -eq 0 ] && TEMPLATE="public/sermons.html"
  [ "$BACK_LINK_GIVEN" -eq 0 ] && BACK_LINK="/sermons"
  [ "$BACK_LABEL_GIVEN" -eq 0 ] && BACK_LABEL="All sermons"
fi
# --output wins over everything; otherwise --slug re-derives the path for
# the kind; otherwise an explicit OUTPUT env wins; otherwise kind default.
if [ "$OUTPUT_FLAG" -eq 1 ]; then
  :
elif [ "$SLUG_FLAG" -eq 1 ]; then
  OUTPUT="${KIND_DIR}/${SLUG}.html"
elif [ "$OUTPUT_GIVEN" -eq 0 ]; then
  OUTPUT="${KIND_DIR}/${SLUG}.html"
fi
SHARE_PATH="${SHARE_DIR}/${SLUG}"
export KIND KEYTERMS KIND_TITLE NOUN BACK_LINK BACK_LABEL SPEAKER_MAP

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
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
  if [ "$KIND" = "podcast" ]; then
    cat > "$TRANSCRIPT_TXT" <<'EOF'
[TRANSCRIPT PLACEHOLDER — re-run scripts/transcripts/add-transcript.sh with $ASSEMBLYAI_API_KEY set to fill this in.]

The audio for this episode is available above. The full transcript will appear here once generated.
EOF
  else
    cat > "$TRANSCRIPT_TXT" <<'EOF'
[TRANSCRIPT PLACEHOLDER — re-run scripts/transcripts/add-transcript.sh with $ASSEMBLYAI_API_KEY set to fill this in.]

The audio for this sermon is available above. The full transcript will appear here once generated.
EOF
  fi
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
import json, os, sys
data = json.load(open(sys.argv[1]))
out_path, words_path = sys.argv[2], sys.argv[3]
# SPEAKER_MAP "A=Rich Richardson,B=Mark Johnson Jr." renames diarization
# codes to real names; unmapped codes keep the "Speaker X" display.
smap = {}
for pair in os.environ.get("SPEAKER_MAP", "").split(","):
    if "=" in pair:
        k, v = pair.split("=", 1)
        k, v = k.strip(), v.strip()
        if k and v:
            smap[k] = v
def disp(s):
    s = str(s or "")
    return smap.get(s, "Speaker " + s if s else s)
utterances = data.get("utterances") or []
if utterances:
    multi = len({u.get("speaker") for u in utterances}) > 1
    turns, cur_spk, buf = [], None, []
    for u in utterances:
        spk = disp(u.get("speaker", "?"))
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
        text = "\n\n".join("[%s] %s" % (s, t) for s, t in turns)
    else:
        text = " ".join(t for _, t in turns)
else:
    text = (data.get("text") or "").strip()
with open(out_path, "w") as f:
    f.write(text.strip() + "\n" if text.strip() else "")
# Preserve word-level timings (ms -> s) for pause-based chunking.
# Speaker codes are renamed via SPEAKER_MAP for consistency with the text.
words = data.get("words") or []
if not words:
    for u in utterances:
        words.extend(u.get("words") or [])
timed = [{"t": w.get("text", ""), "start": (w.get("start") or 0) / 1000.0,
          "end": (w.get("end") or 0) / 1000.0, "speaker": disp(w.get("speaker"))}
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
import json, os, sys
audio_url, out = sys.argv[1], sys.argv[2]
kt = [k.strip() for k in os.environ.get("KEYTERMS", "").split(",") if k.strip()]
if not kt:
    if os.environ.get("KIND") == "podcast":
        kt = ["Jesus", "Bible", "faith", "church", "Gospel"]
    else:
        kt = ["Acts", "Paul", "Ephesus", "Miletus", "Holy Spirit",
              "elders", "overseers", "shepherd", "pastor",
              "Troas", "Assos", "Mitylene", "Luke"]
body = {
    "audio_url": audio_url,
    "speech_models": ["universal-3-5-pro"],
    "speaker_labels": True,
    "keyterms_prompt": kt,
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
export TITLE PUBDATE GUID AUDIO_URL DURATION DESCRIPTION SPEAKER SERIES TRANSCRIPT_TXT OUTPUT TEMPLATE TRANSCRIPT_WORDS PAUSE_GAP SPEAKER_MAP
python3 <<'EOF'
import html, json, os, re

SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=(?:\[[^\]]+\]\s*)?[A-Z0-9\"'])")
SPEAKER_RE = re.compile(r"^\[([^\]]+)\]\s*")

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
        # Turn-boundary markers stranded mid-sentence (diarization often
        # splits mid-thought) are artifacts, not speech: drop them. Only
        # the leading marker (above) carries the speaker turn.
        part = re.sub(r"\s*\[[^\]]+\]", "", part).strip()
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
        prefix = "[%s] " % spk if (multi and spk and spk != prev) else ""
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
    # consume their bounds in order, so alignment holds. Multi-speaker
    # paragraphs get a bold name label (plain <strong>, no extra CSS).
    sent_list = split_sentences(text)
    multi_spk = len({s for s, _ in sent_list if s}) > 1
    bnds = sentence_bounds(sent_list, timed)
    bmap = {}
    for (spk, sent), (s, e) in zip(sent_list, bnds):
        bmap.setdefault(sent, []).append((s, e))
    def spanify(para):
        m = SPEAKER_RE.match(para)
        pname = m.group(1) if m else None
        parts = []
        for spk, sent in split_sentences(para):
            lst = bmap.get(sent) or [(0.0, 0.0)]
            s, e = lst.pop(0)
            parts.append('<span class="tl-s" data-s="%.2f" data-e="%.2f">%s</span>'
                         % (s, e, html.escape(sent)))
        label = '<strong>%s:</strong> ' % html.escape(pname) if (multi_spk and pname) else ''
        return label + " ".join(parts)
    body_html = "\n".join("        <p>%s</p>" % spanify(p) for p in paras) or "        <p>(Empty transcript.)</p>"
else:
    # No timings (plain-text input): plain paragraphs, read-along JS stays idle.
    # Multi-speaker paragraphs get the same bold name label.
    _multi_spk = len({s for s, _ in split_sentences(text) if s}) > 1
    def labelize(p):
        m = SPEAKER_RE.match(p)
        if m and _multi_spk:
            return '<strong>%s:</strong> %s' % (html.escape(m.group(1)), html.escape(p[m.end():].strip()))
        return html.escape(p)
    body_html = "\n".join("        <p>%s</p>" % labelize(p) for p in paras) or "        <p>(Empty transcript.)</p>"
notice = ""
if placeholder:
    notice = ('        <p class="transcript-notice"><strong>Note:</strong> this is a placeholder transcript. '
              'Re-run <code>scripts/transcripts/add-transcript.sh</code> with <code>$ASSEMBLYAI_API_KEY</code> set '
              'to generate the full transcript.</p>\n')

def fmt_pubdate(s):
    """Render YYYY-MM-DD (or nearby variants) as 'May 27, 2026' to match
    the podcast archive list (en-US) instead of raw ISO in the header."""
    from datetime import datetime
    s = (s or "").strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%b %d, %Y", "%B %d, %Y"):
        try:
            d = datetime.strptime(s, fmt)
            return "%s %d, %d" % (d.strftime("%b"), d.day, d.year)
        except ValueError:
            continue
    return s

meta_bits = " · ".join(b for b in [speaker, series, fmt_pubdate(pubdate)] if b)

kind_title = os.environ.get("KIND_TITLE", "Sermon")
back_link = os.environ.get("BACK_LINK", "/sermons")
back_label = os.environ.get("BACK_LABEL", "All sermons")

# Podcast episodes omit the description line: the feed show notes are long,
# truncated, and carry raw markdown, so they render weird in the header.
# Sermon pages keep theirs. (Skipped entirely, not just hidden, so no
# dead markup ships.)
if os.environ.get("KIND") == "podcast":
    desc_html = ""
else:
    desc_html = '\n          <p class="transcript-desc">%s</p>' % html.escape(desc)

main = """  <main>
    <section class="section">
      <div class="container">
        <div class="transcript-head">
          <a class="transcript-back" href="%s">&larr; %s</a>
          <h1 class="display-lg">%s</h1>
          <p class="transcript-meta">%s</p>%s
          <div class="sermon">
            <audio controls preload="none" src="%s"></audio>
          </div>
        </div>
        <div class="transcript" style="white-space:pre-line">
%s%s
        </div>
      </div>
    </section>
  </main>""" % (html.escape(back_link, quote=True), html.escape(back_label),
               html.escape(title), html.escape(meta_bits), desc_html,
               html.escape(audio, quote=True),
               notice, body_html)

new = re.sub(r"<main>.*?</main>", lambda _: main, tpl, count=1, flags=re.DOTALL)
# Strip the dead inline archive <script> block cloned from the archive
# template (sermons.html / podcast.html). It implements the live archive
# feed and early-returns on transcript pages (no [data-sermons-list] node
# in a transcript <main>). Keep /script.js (site nav) and /readalong.js.
new = re.sub(r'  <script>\n  // (?:Live sermon feed:|Fixed on Jesus episode archive,).*?\n  </script>\n?',
             "", new, count=1, flags=re.DOTALL)
title_tag = ("<title>%s — %s Transcript — Center Church Gilbert</title>"
             % (html.escape(title), kind_title))
if "<title>Sermons — Center Church Gilbert</title>" in new:
    new = new.replace("<title>Sermons — Center Church Gilbert</title>", title_tag)
elif "<title>Fixed on Jesus Podcast — Center Church Gilbert</title>" in new:
    new = new.replace("<title>Fixed on Jesus Podcast — Center Church Gilbert</title>", title_tag)
else:
    new = re.sub(r"<title>.*?</title>", lambda _: title_tag, new, count=1)
# Transcript styles + read-along behavior live in shared public/transcript.css
# (header + dark mode: device preference only, no toggle; sentence
# highlight + sticky mini player) so all transcript pages stay in sync —
# styles.css stays untouched and the rest of the site keeps its light theme.
new = new.replace("</head>", '  <link rel="stylesheet" href="/transcript.css?v=3" />\n</head>', 1)

# Read-along audio (sticky mini player, sentence highlight, auto-follow).
# Shared CSS above + public/readalong.js — bump ?v= in public/transcript.css,
# public/readalong.js, here, AND every generated transcript page together
# so browsers pick up changes. Page-specific copy (transcript-acts-20-13-38) links the same
# files. Without word timings the JS finds no .tl-s nodes and stays idle
# (the sticky player bar still works).
new = new.replace("</body>", '  <script src="/readalong.js?v=2"></script>\n</body>', 1)
if "<!-- guid: " not in new:
    new = new.replace("</body>", "<!-- guid: %s -->\n</body>" % html.escape(guid))

with open(os.environ["OUTPUT"], "w") as f:
    f.write(new)
print("Wrote %s" % os.environ["OUTPUT"])
EOF

if [ "$NO_PUSH" -eq 0 ]; then
# Maintain the transcript manifest consulted by /sermons and /podcast (guid -> path).
# Only on real runs: --no-push is a side-effect-free dry run.
python3 - "$GUID" "${SHARE_PATH}" <<'EOF'
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
MSG="${MESSAGE:-Add ${KIND} transcript: ${TITLE}}"
if [ "$NO_PUSH" -eq 1 ]; then
  echo "Next steps (--no-push: commit+push skipped):"
  echo "  1. Review ${OUTPUT} in a browser (unlinked draft — not in nav or sitemap)."
  echo "  2. git add ${OUTPUT} scripts/transcripts/add-transcript.sh public/transcripts.json && git commit -m \"${MSG}\" && git push"
  echo "     (push to main deploys via the existing GitHub Action)"
  echo "  3. Share the direct URL path: ${SHARE_PATH}"
else
  # Stage ONLY these three paths — never `git add -A`. Unrelated dirty files
  # (staged or not) are left untouched.
  git add -- "${OUTPUT}" scripts/transcripts/add-transcript.sh public/transcripts.json
  if git diff --cached --quiet -- "${OUTPUT}" scripts/transcripts/add-transcript.sh public/transcripts.json; then
    echo "Nothing new to commit (${OUTPUT} and script unchanged)."
  else
    git commit -m "${MSG}" -- "${OUTPUT}" scripts/transcripts/add-transcript.sh public/transcripts.json
    if git push; then
      echo "Pushed to main (deploys via the existing GitHub Action)."
    else
      echo "ERROR: git push failed. Retry manually: git push" >&2
      exit 1
    fi
  fi
  echo "Done. Review ${OUTPUT} in a browser (unlinked draft — not in nav or sitemap)."
  echo "Share the direct URL path: ${SHARE_PATH}"
fi
