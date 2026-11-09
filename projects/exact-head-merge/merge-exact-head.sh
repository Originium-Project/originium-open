#!/usr/bin/env bash
# Merge a GitHub pull request only if it is exactly the commit that was tested.
#
# usage: merge-exact-head.sh [--dry-run] [--allow-no-checks] OWNER/REPO PR_NUMBER TESTED_SHA
#
# The merge goes ahead only when all of these hold:
#   1. the pull request is open;
#   2. its head commit equals TESTED_SHA (the 40-character commit the tests ran on);
#   3. that head already contains the base branch (nothing on the base is missing from it);
#   4. every check on the head has finished and none failed (no checks at all is refused
#      unless --allow-no-checks is given).
# Then it runs: gh pr merge PR --merge --match-head-commit TESTED_SHA
# With --dry-run it prints the verdict and merges nothing.
#
# Exit status: 0 ready (dry run) or merged, 1 refused or the merge command failed,
# 2 bad usage or a failed lookup (the error is then on stderr, not a verdict line).
# Base branch names that contain a slash are not supported (the comparison lookup is expected to
# fail, and then the script exits 2 without merging; not tested against GitHub).
# Needs: gh (authenticated), jq.
set -u

dry=0
allow_none=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1; shift ;;
    --allow-no-checks) allow_none=1; shift ;;
    --) shift; break ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) break ;;
  esac
done
if [ $# -ne 3 ]; then
  echo "usage: $0 [--dry-run] [--allow-no-checks] OWNER/REPO PR_NUMBER TESTED_SHA" >&2
  exit 2
fi
repo=$1; pr=$2; sha=$3

# The whole string must match (a newline inside the value cannot slip past a per-line match).
if ! [[ $repo =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || [[ $repo == */. || $repo == */.. || $repo == ./* || $repo == ../* ]]; then
  echo "repo must look like OWNER/REPO" >&2; exit 2
fi
case "$pr" in ''|*[!0-9]*) echo "PR number must be digits" >&2; exit 2 ;; esac
if ! [[ $sha =~ ^[0-9a-f]{40}$ ]]; then
  echo "TESTED_SHA must be a full 40-character lowercase commit id" >&2
  exit 2
fi

refuse() { echo "REFUSED: $*"; exit 1; }

view=$(gh pr view "$pr" -R "$repo" --json state,headRefOid,baseRefName) || { echo "cannot read the pull request" >&2; exit 2; }
state=$(printf '%s' "$view" | jq -r .state) || exit 2
head=$(printf '%s' "$view" | jq -r .headRefOid) || exit 2
base=$(printf '%s' "$view" | jq -r .baseRefName) || exit 2

[ "$state" = "OPEN" ] || refuse "the pull request is $state, not OPEN"
[ "$head" = "$sha" ] || refuse "head is ${head:0:12}, not the tested ${sha:0:12}"

behind=$(gh api "repos/$repo/compare/$base...$sha" --jq .behind_by) || { echo "cannot compare with the base branch" >&2; exit 2; }
[ "$behind" = "0" ] || refuse "head is $behind commit(s) behind $base"

# gh exits non-zero while checks are pending (8) and when none are reported (1); the JSON is still read.
# Any other failure (sign-in, network, an older gh without --json) is a failed lookup, not "no checks".
checks_note="its checks are green"
errfile=$(mktemp) || exit 2
trap 'rm -f "$errfile"' EXIT
checks=$(gh pr checks "$pr" -R "$repo" --json name,bucket 2>"$errfile")
rc=$?
if [ -z "$checks" ] || [ "$checks" = "[]" ]; then
  if [ "$rc" -ne 0 ] && ! grep -q "no checks reported" "$errfile"; then
    echo "cannot read the checks: $(head -c 200 "$errfile")" >&2
    exit 2
  fi
  [ "$allow_none" = 1 ] || refuse "no checks are reported for this head (use --allow-no-checks to accept that)"
  checks_note="no checks were reported (accepted by --allow-no-checks)"
else
  bad=$(printf '%s' "$checks" | jq -r '[.[] | select(.bucket != "pass" and .bucket != "skipping") | "\(.name)=\(.bucket)"] | join(", ")') || exit 2
  [ -z "$bad" ] || refuse "checks not green: $bad"
fi

if [ "$dry" = 1 ]; then
  echo "READY: ${sha:0:12} is open, current with $base, and $checks_note (dry run, nothing merged)"
  exit 0
fi
gh pr merge "$pr" -R "$repo" --merge --match-head-commit "$sha" || exit 1
# gh accepted the merge request; on a repository with a merge queue it may be queued, not yet merged.
echo "MERGED: $repo #$pr at ${sha:0:12}"
