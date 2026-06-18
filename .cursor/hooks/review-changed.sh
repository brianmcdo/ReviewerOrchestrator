#!/bin/bash
# stop hook: after the implementor agent finishes a turn, find source files that
# changed since the last review and ask the agent to run the isolated Reviewer
# (one fresh subagent per file). Writes nothing except its own state file.
#
# Output contract (stdout JSON):
#   {}                              -> nothing new to review, agent stops normally
#   { "followup_message": "..." }   -> continue the agent to dispatch reviews
#
# Loop safety: we record a content signature per reviewed file in a state file and
# only re-trigger when a file's content signature is new. hooks.json also sets a
# loop_limit as a hard backstop.

set -euo pipefail

# Consume stdin (hook input JSON). We drive off git, so we don't need its fields,
# but we must read it so the pipe doesn't break.
cat >/dev/null 2>&1 || true

# Resolve repo root; fail open (emit {}) if we're not in a git repo.
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT" ]; then
  echo '{}'
  exit 0
fi
cd "$ROOT"

STATE_FILE=".cursor/hooks/.review-state"
mkdir -p .cursor/hooks
touch "$STATE_FILE"

# Base for the diff: HEAD if there is a commit, otherwise the empty tree.
if git rev-parse --verify -q HEAD >/dev/null 2>&1; then
  BASE="HEAD"
else
  BASE=$(git hash-object -t tree /dev/null)
fi

# Collect candidate changed files: unstaged + staged + untracked.
{
  git diff --name-only "$BASE" 2>/dev/null || true
  git diff --name-only --cached 2>/dev/null || true
  git ls-files --others --exclude-standard 2>/dev/null || true
} | sort -u > /tmp/.review-candidates.$$ || true

# Filter out paths the Reviewer shouldn't loop on or care about.
# Excludes the .cursor control surface (incl. the memory the Reviewer writes),
# VCS internals, common vendored/generated dirs, and generated lockfiles.
#
# NOTE: kept in sync BY HAND with the EXCLUDE regex in tools/reviewer/src/git.ts.
# If you change one, change the other.
EXCLUDE_RE='(^(\.cursor/|\.git/|node_modules/|dist/|build/|out/|\.next/|coverage/|vendor/|target/|tools/reviewer/(node_modules|dist)/))|((^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb)$)|(\.lock$)'

CHANGED=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if printf '%s\n' "$f" | grep -Eq "$EXCLUDE_RE"; then continue; fi
  [ -f "$f" ] || continue   # skip deletions
  CHANGED="$CHANGED$f"$'\n'
done < /tmp/.review-candidates.$$
rm -f /tmp/.review-candidates.$$

# Build "sig\tpath" signatures for the current changed set.
CUR_SIGS=""
TO_REVIEW=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  sig=$(git hash-object "$f" 2>/dev/null || echo "nohash")
  line="$sig	$f"
  CUR_SIGS="$CUR_SIGS$line"$'\n'
  if ! grep -Fxq "$line" "$STATE_FILE"; then
    TO_REVIEW="$TO_REVIEW$f"$'\n'
  fi
done <<EOF
$CHANGED
EOF

# Nothing new since the last review -> let the agent stop.
if [ -z "$(printf '%s' "$TO_REVIEW" | tr -d '[:space:]')" ]; then
  echo '{}'
  exit 0
fi

# Record the current signatures so reviewed files don't re-trigger.
printf '%s' "$CUR_SIGS" > "$STATE_FILE"

# Build the followup message asking the agent to dispatch one isolated reviewer
# subagent per changed file.
FILE_LIST=$(printf '%s' "$TO_REVIEW" | sed '/^$/d' | sed 's/^/- /')

MESSAGE="Automated review trigger: the following source files changed since the last review.

$FILE_LIST

For EACH file above, launch a SEPARATE reviewer subagent (fresh, isolated context via the Task tool) that:
1. Adopts the Reviewer persona in .cursor/rules/reviewer.mdc.
2. Reads .cursor/memory/{architecture,patterns,playbook,concerns}.md for prior context.
3. Reviews ONLY that one file against the reviewer checklist.
4. Updates the memory files (append a concerns.md entry; refine architecture/patterns/playbook as needed). Do NOT modify any source code.
5. Returns a terse concerns summary.

Run the per-file reviewers in parallel where possible. When they finish, present me a consolidated, severity-ordered list of concerns. Do not start new code changes until I have seen the concerns."

# Emit JSON safely with jq.
jq -n --arg msg "$MESSAGE" '{ followup_message: $msg }'
exit 0
