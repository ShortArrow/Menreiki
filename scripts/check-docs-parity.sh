#!/usr/bin/env bash
# Bilingual docs must move together: when one side of an EN/JA pair changes
# in a diff range, the other side must change too (ADR-011 — Japanese-first,
# but published pairs stay in sync).
#
#   scripts/check-docs-parity.sh [<git range>]     # default HEAD^..HEAD
#   CHANGED_FILES="a.md b.jp.md" scripts/check-docs-parity.sh   # for tests
set -euo pipefail
cd "$(dirname "$0")/.."

range="${1:-HEAD^..HEAD}"
if [ -n "${CHANGED_FILES:-}" ]; then
  changed="$(tr ' ' '\n' <<<"$CHANGED_FILES")"
else
  changed="$(git diff --name-only "$range")"
fi

# Discover pairs: every tracked X.jp.md whose X.md sibling exists, plus the
# root README whose Japanese half lives under docs/.
pairs=()
while IFS= read -r ja; do
  en="${ja%.jp.md}.md"
  [ -f "$en" ] && pairs+=("$en $ja")
done < <(git ls-files '*.jp.md')
pairs+=("README.md docs/README.jp.md")

status=0
for pair in "${pairs[@]}"; do
  en="${pair% *}"
  ja="${pair#* }"
  en_changed=0
  ja_changed=0
  grep -qx "$en" <<<"$changed" && en_changed=1
  grep -qx "$ja" <<<"$changed" && ja_changed=1
  if [ "$en_changed" != "$ja_changed" ]; then
    echo "::error::両輪更新が必要です: $en と $ja の片方だけが変更されています (range: $range)"
    status=1
  fi
done

if [ "$status" = 0 ]; then
  echo "docs parity OK (${#pairs[@]} pairs checked)"
fi
exit "$status"
