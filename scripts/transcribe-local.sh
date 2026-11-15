#!/usr/bin/env bash
# Local sermon transcription with whisper.cpp (free, no API key).
#
#   ./scripts/transcribe-local.sh "https://.../sermon.mp3" [out-prefix]
#   ./scripts/transcribe-local.sh /path/to/sermon.mp3 [out-prefix]
#
# Downloads ggml-large-v3-turbo into $MODEL_DIR on first run, transcribes
# with word-level timestamps, and writes <out>.txt + <out>.words.json.
# Then:
#   ./scripts/add-transcript.sh --transcript-file <out>.txt \
#       --transcript-words <out>.words.json --pause-gap 1.4 [other flags]
#
# Deps: bash, curl, python3 (stdlib only), whisper-cli
# (brew install whisper-cpp). Model is ~1.6GB; transcription runs at
# ~15x real-time on Apple Silicon (Metal).
set -euo pipefail

AUDIO="${1:-}"
OUT="${2:-sermon}"
MODEL_NAME="${MODEL_NAME:-ggml-large-v3-turbo.bin}"
MODEL_DIR="${MODEL_DIR:-$HOME/.cache/center-church-whisper}"
MODEL_URL="${MODEL_URL:-https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}}"
THREADS="${THREADS:-8}"

[ -n "$AUDIO" ] || { echo "Usage: $0 <audio-url-or-file> [out-prefix]" >&2; exit 1; }
command -v whisper-cli >/dev/null || {
  echo "ERROR: whisper-cli not found. Install it: brew install whisper-cpp" >&2
  exit 1
}

mkdir -p "$MODEL_DIR"
if [ ! -f "$MODEL_DIR/$MODEL_NAME" ]; then
  echo "Downloading $MODEL_NAME (~1.6GB, one-time)..."
  curl -sSL -o "$MODEL_DIR/$MODEL_NAME" "$MODEL_URL"
fi

SRC="$AUDIO"
case "$AUDIO" in
  http://*|https://*)
    SRC="${OUT}.mp3"
    if [ ! -f "$SRC" ]; then
      echo "Downloading audio..."
      curl -sSL -o "$SRC" "$AUDIO"
    else
      echo "Reusing audio: $SRC"
    fi
    ;;
esac
[ -f "$SRC" ] || { echo "Not found: $SRC" >&2; exit 1; }

echo "Transcribing (large-v3-turbo, word timestamps)..."
# shellcheck disable=SC2086
whisper-cli -m "$MODEL_DIR/$MODEL_NAME" -l en --split-on-word \
  --output-txt --output-json-full --output-file "$OUT" \
  -t "$THREADS" "$SRC"

"$(dirname "$0")/whisper-words.py" "${OUT}.json" "${OUT}.words.json"

echo
echo "Next:"
echo "  ./scripts/add-transcript.sh --transcript-file ${OUT}.txt \\"
echo "      --transcript-words ${OUT}.words.json --pause-gap 1.4 [other flags]"
