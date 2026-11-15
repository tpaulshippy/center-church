#!/usr/bin/env bash
# Add an unlinked sermon-transcript static page.
#
# Default targets last week's sermon (Acts 20:13-38, 2026-11-08).
# Override any field via env vars or CLI flags for future sermons:
#
#   AUDIO_URL TITLE SPEAKER SERIES DESCRIPTION PUBDATE DURATION GUID SLUG OUTPUT TRANSCRIPT_FILE TRANSCRIPT_ID
#
# Examples:
#   ./scripts/add-transcript.sh
#   AUDIO_URL="https://.../sermon.mp3" TITLE="Acts 21:1-14" ./scripts/add-transcript.sh
#   ./scripts/add-transcript.sh --audio-url https://.../x.mp3 --title "Acts 21:1-14" \
#     --speaker "Rich Richardson" --series Acts --pubdate 2026-11-15 --slug transcript-acts-21-1-14
#   ./scripts/add-transcript.sh --transcript-id 098422e6-80de-420f-ad1c-d0fec7462169  # reuse completed transcript, no re-transcribe
#   ./scripts/add-transcript.sh --transcript-file /tmp/sermon.txt   # skip AssemblyAI, use local text
#   ./scripts/add-transcript.sh --no-push                            # write HTML only, print manual git commands
#   ./scripts/add-transcript.sh --message "Custom commit msg"        # override commit message
#
# After writing the HTML the script auto-commits (message
# "Add sermon transcript: <TITLE>") and pushes to main, unless --no-push.
#   ./scripts/add-transcript.sh --placeholder                          # placeholder page, no API call
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
    --transcript-id)   TRANSCRIPT_ID="$2"; shift 2 ;;
    --message)         MESSAGE="$2"; shift 2 ;;
    --no-push)         NO_PUSH=1; shift ;;
    --placeholder)     PLACEHOLDER=1; shift ;;
    -h|--help)         usage; exit 0 ;;
    *) echo "Unknown arg: $1 (see --help)" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TEMPLATE="public/sermons.html"
[ -f "$TEMPLATE" ] || { echo "Template not found: $TEMPLATE" >&2; exit 1; }

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
TRANSCRIPT_TXT="$TMPDIR/transcript.txt"

write_placeholder() {
  cat > "$TRANSCRIPT_TXT" <<'EOF'
[TRANSCRIPT PLACEHOLDER — re-run scripts/add-transcript.sh with $ASSEMBLYAI_API_KEY set to fill this in.]

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

  # Transcript JSON (completed) -> plain paragraph-per-line text file.
  # Single-speaker audio collapses to one text stream (speaker-grouping would
  # yield a single giant paragraph); sentence-aware chunking into readable
  # <p>s happens at render time. [Speaker X] prefixes are kept only where
  # diarization actually switches speakers.
  render_json() {
    python3 - "$1" "$TRANSCRIPT_TXT" <<'EOF'
import json, sys
data = json.load(open(sys.argv[1]))
out_path = sys.argv[2]
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
export TITLE PUBDATE GUID AUDIO_URL DURATION DESCRIPTION SPEAKER SERIES TRANSCRIPT_TXT OUTPUT TEMPLATE
python3 <<'EOF'
import html, os, re

SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=(?:\[Speaker [^\]]+\]\s*)?[A-Z0-9\"'])")
SPEAKER_RE = re.compile(r"^\[Speaker ([^\]]+)\]\s*")

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

def chunk_paragraphs(text):
    """Sentence-aware chunking: ~6-10 sentences or ~150-200 words per
    paragraph, whichever comes first. Speaker-change forces a break and keeps
    its [Speaker X] label; single-speaker text gets plain <p>s."""
    sentences = split_sentences(text)
    multi = len({s for s, _ in sentences if s}) > 1
    grouped, cur, words, cur_spk = [], [], 0, None
    for spk, sent in sentences:
        if cur and (spk != cur_spk or (len(cur) >= 6 and words >= 150)
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
if not placeholder:
    # Sentence-chunk every block so single-speaker transcripts don't collapse
    # into one giant <p>; short blocks pass through unchanged.
    text = " ".join(paras)
    paras = chunk_paragraphs(text)
body_html = "\n".join("        <p>%s</p>" % html.escape(p) for p in paras) or "        <p>(Empty transcript.)</p>"
notice = ""
if placeholder:
    notice = ('        <p class="transcript-notice"><strong>Note:</strong> this is a placeholder transcript. '
              'Re-run <code>scripts/add-transcript.sh</code> with <code>$ASSEMBLYAI_API_KEY</code> set '
              'to generate the full transcript.</p>\n')

meta_bits = " · ".join(b for b in [speaker, series, pubdate, duration] if b)

main = """  <main>
    <section class="page-hero">
      <div class="hero-bg"><img class="focus-right" src="/photos/preaching-matt.jpg" alt="Pastor preaching verse-by-verse at Center Church" /></div>
      <div class="container hero-inner">
        <span class="eyebrow on-dark">Sermon transcript</span>
        <h1 class="display-xl">%s</h1>
        <p class="sub">%s</p>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="sermon">
          <div>
            <h3>%s</h3>
            <div class="meta">%s</div>
            <p>%s</p>
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
               html.escape(title), html.escape(meta_bits),
               html.escape(desc), html.escape(audio, quote=True),
               notice, body_html)

new = re.sub(r"<main>.*?</main>", lambda _: main, tpl, count=1, flags=re.DOTALL)
new = new.replace("<title>Sermons — Center Church Gilbert</title>",
                  "<title>%s — Sermon Transcript — Center Church Gilbert</title>" % html.escape(title))
if "<!-- guid: " not in new:
    new = new.replace("</body>", "<!-- guid: %s -->\n</body>" % html.escape(guid))

with open(os.environ["OUTPUT"], "w") as f:
    f.write(new)
print("Wrote %s" % os.environ["OUTPUT"])
EOF

echo
MSG="${MESSAGE:-Add sermon transcript: ${TITLE}}"
if [ "$NO_PUSH" -eq 1 ]; then
  echo "Next steps (--no-push: commit+push skipped):"
  echo "  1. Review ${OUTPUT} in a browser (unlinked draft — not in nav or sitemap)."
  echo "  2. git add ${OUTPUT} scripts/add-transcript.sh && git commit -m \"${MSG}\" && git push"
  echo "     (push to main deploys via the existing GitHub Action)"
  echo "  3. Share the direct URL path: /sermons/${SLUG}"
else
  # Stage ONLY these two paths — never `git add -A`. Unrelated dirty files
  # (staged or not) are left untouched.
  git add -- "${OUTPUT}" scripts/add-transcript.sh
  if git diff --cached --quiet -- "${OUTPUT}" scripts/add-transcript.sh; then
    echo "Nothing new to commit (${OUTPUT} and script unchanged)."
  else
    git commit -m "${MSG}" -- "${OUTPUT}" scripts/add-transcript.sh
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
