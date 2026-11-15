#!/usr/bin/env python3
"""Convert whisper.cpp full-JSON output to the words file add-transcript.sh wants.

Usage:
    scripts/whisper-words.py whisper.json words.json

Input:  whisper.cpp `--output-json-full` file (use `--split-on-word` for true
        word-level times; without it token times are coarse).
Output: JSON list [{"t": word, "start": seconds, "end": seconds}] — the
        --transcript-words format. Times are floats; control tokens
        ([_BEG_], [_TT_*], ...) are dropped and subword pieces merged.

Stdlib only. Then:
    ./scripts/add-transcript.sh --transcript-file sermon.txt \
        --transcript-words words.json --pause-gap 1.4
"""
import json
import re
import sys

CONTROL = re.compile(r"\[_.*?_\]")


def to_seconds(ts):
    # "HH:MM:SS,mmm" or "HH:MM:SS.mmm" -> float seconds
    h, m, rest = ts.split(":")
    return int(h) * 3600 + int(m) * 60 + float(rest.replace(",", "."))


def main():
    if len(sys.argv) != 3 or sys.argv[1] in ("-h", "--help"):
        print(__doc__.strip())
        sys.exit(0 if len(sys.argv) == 2 else 1)
    data = json.load(open(sys.argv[1]))
    segments = data.get("transcription", data.get("segments", []))
    timed, cur, start, end = [], None, None, None

    def flush():
        nonlocal cur, start, end
        if cur:
            timed.append({"t": cur, "start": start, "end": end})
        cur, start, end = None, None, None

    for seg in segments:
        for tok in seg.get("tokens", []) or []:
            if not isinstance(tok, dict):
                continue
            text = CONTROL.sub("", tok.get("text", ""))
            if not text:
                continue
            ts = tok.get("timestamps", {}) or {}
            try:
                t0 = to_seconds(ts["from"])
                t1 = to_seconds(ts["to"])
            except (KeyError, ValueError):
                continue
            if text.startswith(" ") or cur is None:
                flush()
                cur, start, end = text.strip(), t0, t1
            else:
                cur += text
                end = t1
    flush()
    timed = [w for w in timed if w["t"]]
    json.dump(timed, open(sys.argv[2], "w"))
    print("Wrote %s (%d words)" % (sys.argv[2], len(timed)))


if __name__ == "__main__":
    main()
