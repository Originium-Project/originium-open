#!/usr/bin/env bash
# Linux only (the hook it inspects uses flock and /proc). Self-contained test of check-identity.sh with a throwaway bare remote: bash tests/check-identity.test.sh
set -u
if ! command -v flock >/dev/null 2>&1 || [ ! -r /proc/self/fdinfo ]; then echo "skip: flock or /proc/self/fdinfo is missing (Linux only)"; exit 0; fi
here=$(cd "$(dirname "$0")/.." && pwd); t=$(mktemp -d); trap 'rm -rf "$t"' EXIT; fail=0
# Keep the caller's git environment and configuration out of the throwaway repositories.
unset $(git rev-parse --local-env-vars) 2>/dev/null; export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
git init -q --bare "$t/hub.git" && git clone -q "$t/hub.git" "$t/w" 2>/dev/null && cd "$t/w" || exit 2
git config user.name role && git config user.email agent@users.noreply.local
commit() { GIT_AUTHOR_EMAIL=$1 GIT_COMMITTER_EMAIL=$2 git commit -q --allow-empty -m "$3"; }
expect() { if "$here/check-identity.sh" "$(git rev-parse HEAD)" 2>/dev/null; then got=0; else got=1; fi; [ "$got" = "$1" ] && echo "ok   $2" || { echo "FAIL $2"; fail=1; }; }
# main on the remote; the branch pushed once.
git checkout -q -b main && commit agent@users.noreply.local agent@users.noreply.local base && git push -q origin main
git checkout -q -b feature && commit agent@users.noreply.local agent@users.noreply.local one && git push -q origin feature
expect 0 "nothing new: passes"
# The hosting service merges a pull request into main: its merge commit carries a person's address and noreply@github.com.
git checkout -q main && git checkout -q -b side && commit agent@users.noreply.local agent@users.noreply.local side
git checkout -q main && GIT_AUTHOR_EMAIL=owner@example.com GIT_COMMITTER_EMAIL=noreply@github.com git merge -q --no-ff --no-edit side && git push -q origin main
# The existing branch merges main (with the role identity) and adds a commit.
git checkout -q feature && git merge -q --no-edit main && commit agent@users.noreply.local agent@users.noreply.local two
expect 0 "an existing branch with main's service-written merge merged in passes"
commit person@example.com agent@users.noreply.local bad
expect 1 "the same branch with one commit under a non-role address is refused"
git reset -q --hard HEAD~1
commit agent@users.noreply.local person@example.com bad-committer
expect 1 "a non-role committer is refused"
git reset -q --hard HEAD~1
PUSH_GUARD_OWNER_PUSH=1 expect 0 "a person pushing their own commits may pass" 2>/dev/null
# A rebased branch (forced push): its rewritten commits are new and are checked.
git checkout -q -b rebased origin/feature && GIT_COMMITTER_EMAIL=person@example.com git rebase -q main 2>/dev/null
expect 1 "a rebased branch is checked on its new commits (a non-role committer from the rebase is refused)"
git checkout -q -b rebased-ok origin/feature && git rebase -q main 2>/dev/null
expect 0 "a rebased branch under the role identity passes"
commit agent@users.noreply.local agent@users.noreply.local.example.com lookalike
expect 1 "a look-alike domain is refused"
# The hook hands the check only the local sha (its own range), never the pushed range old..new.
grep -q '"$guard_dir/check-identity.sh" "$local_sha" || exit 1' "$here/pre-push" && echo "ok   the hook calls the check with the local sha only" || { echo "FAIL the hook's call"; fail=1; }
exit "$fail"
