#!/usr/bin/env bash
# A migration created before the newest one already on main would be refused
# by `supabase db push` AFTER merge (ported from tacit-internal's scripts/ci) -- fail here instead, so the author renames
# the file to a fresh timestamp while it's still a PR.
set -euo pipefail

git fetch --depth=1 origin main
dir=supabase/migrations/
on_main=$(git ls-tree -r --name-only FETCH_HEAD -- "$dir" | grep '\.sql$' | sort || true)
latest_main=$(echo "$on_main" | tail -1)
if [ -z "$latest_main" ]; then
  echo "No migrations on main yet -- nothing to order against."
  exit 0
fi

fail=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [[ "$(basename "$f")" < "$(basename "$latest_main")" ]]; then
    echo "::error file=$f::$(basename "$f") sorts before $(basename "$latest_main"), which is already on main. supabase db push would refuse this after merge. Rename it to a fresh timestamp: 'supabase migration new <name>' and move your SQL into the new file."
    fail=1
  fi
done < <(comm -13 <(echo "$on_main") <(git ls-tree -r --name-only HEAD -- "$dir" | grep '\.sql$' | sort || true))

[ "$fail" = 0 ] && echo "Migration ordering OK."
exit $fail
