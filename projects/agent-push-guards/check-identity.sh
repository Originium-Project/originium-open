#!/usr/bin/env bash
# Refuses a push whose new commits carry an author or committer address that does not match the role-address
# pattern PUSH_GUARD_ROLE_PATTERN (a bash `case` glob, default *@users.noreply.local).
# Run by the pre-push hook FIRST, before any scan or suite: a session whose shell lacked its identity variables
# writes the machine's global personal address into a commit, and that address must not reach the remote.
#   check-identity.sh <local sha>
# It checks the commits reachable from <local sha> that are on NO remote yet ("<sha> --not --remotes"), for a new
# branch, an existing one and a forced push alike. Never the pushed range old..new: a branch that merged the
# default branch holds the hosting service's own merge commits, which are right as they are.
# A person pushing their own commits: PUSH_GUARD_OWNER_PUSH=1 (theirs to set, never an agent's).
set -u
sha=${1:?usage: check-identity.sh <local sha>}
[ "${PUSH_GUARD_OWNER_PUSH:-}" = 1 ] && exit 0
pattern=${PUSH_GUARD_ROLE_PATTERN:-*@users.noreply.local}
bad=0
while IFS=' ' read -r c author committer; do
  for who in "author:$author" "committer:$committer"; do
    addr=${who#*:}
    # shellcheck disable=SC2254
    case "$addr" in
      $pattern) ;;
      *) echo "pre-push: commit ${c:0:7} has ${who%%:*} <${addr}>: only role addresses (${pattern}) may be pushed; rewrite it with your role's identity" >&2; bad=1 ;;
    esac
  done
done < <(git log --format='%H %ae %ce' "$sha" --not --remotes)
exit "$bad"
