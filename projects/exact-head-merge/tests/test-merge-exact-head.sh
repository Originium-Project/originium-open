#!/usr/bin/env bash
# Offline tests: a stub `gh` answers from environment variables; nothing touches the network.
set -u
here=$(cd "$(dirname "$0")" && pwd)
script="$here/../merge-exact-head.sh"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
OTHER=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

cat > "$tmp/gh" <<'STUB'
#!/usr/bin/env bash
case "$1 $2" in
  "pr view")   printf '%s' "$STUB_VIEW" ;;
  "pr checks") printf '%s' "${STUB_CHECKS:-}"; [ -n "${STUB_CHECKS_ERR:-}" ] && echo "$STUB_CHECKS_ERR" >&2; exit "${STUB_CHECKS_RC:-0}" ;;
  "pr merge")  echo "$*" >> "$STUB_LOG" ;;
  "api repos/o/r/compare/main...aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") printf '%s\n' "${STUB_BEHIND:-0}" ;;
  *) echo "unexpected gh call: $*" >&2; exit 9 ;;
esac
STUB
chmod +x "$tmp/gh"
export PATH="$tmp:$PATH" STUB_LOG="$tmp/merge.log" STUB_CHECKS_RC=0 STUB_CHECKS_ERR="" STUB_BEHIND=0

fail=0
# expect NAME EXPECTED_EXIT EXPECTED_TEXT [args...]
expect() {
  name=$1; want_rc=$2; want_text=$3; shift 3
  out=$("$script" "$@" 2>&1); rc=$?
  if [ "$rc" != "$want_rc" ] || ! printf '%s' "$out" | grep -qF -- "$want_text"; then
    echo "FAIL $name: rc=$rc out=$out"; fail=1
  else
    echo "ok   $name"
  fi
}
view() { printf '{"state":"%s","headRefOid":"%s","baseRefName":"main"}' "$1" "$2"; }
green='[{"name":"t","bucket":"pass"},{"name":"s","bucket":"skipping"}]'

export STUB_VIEW; STUB_VIEW=$(view OPEN $SHA); export STUB_CHECKS="$green"
: > "$STUB_LOG"
expect "ready (dry run)"      0 "READY"   --dry-run o/r 7 $SHA
if [ ! -s "$STUB_LOG" ]; then echo "ok   dry run never merges"; else echo "FAIL dry run called gh pr merge"; fail=1; fi
expect "merges when ready"    0 "MERGED"  o/r 7 $SHA
want="pr merge 7 -R o/r --merge --match-head-commit $SHA"
if [ "$(cat "$STUB_LOG")" = "$want" ]; then echo "ok   merge command is exactly: $want"; else echo "FAIL merge command: $(cat "$STUB_LOG")"; fail=1; fi

STUB_VIEW=$(view OPEN $OTHER);  expect "head moved"        1 "not the tested" o/r 7 $SHA
STUB_VIEW=$(view MERGED $SHA);  expect "already merged"    1 "not OPEN"       o/r 7 $SHA
STUB_VIEW=$(view OPEN $SHA); STUB_BEHIND=3 expect "behind base" 1 "behind main" o/r 7 $SHA
STUB_CHECKS='[{"name":"t","bucket":"fail"}]';    expect "failed check"   1 "t=fail"    o/r 7 $SHA
STUB_CHECKS='[{"name":"t","bucket":"pending"}]'; expect "pending check"  1 "t=pending" o/r 7 $SHA
STUB_CHECKS='' STUB_CHECKS_RC=1 STUB_CHECKS_ERR="no checks reported on the 'x' branch" expect "no checks" 1 "no checks" o/r 7 $SHA
STUB_CHECKS='' STUB_CHECKS_RC=1 STUB_CHECKS_ERR="no checks reported on the 'x' branch" expect "no checks, allowed" 0 "READY" --dry-run --allow-no-checks o/r 7 $SHA
STUB_CHECKS='' STUB_CHECKS_RC=4 STUB_CHECKS_ERR="authentication required" expect "checks lookup fails" 2 "cannot read the checks" --allow-no-checks o/r 7 $SHA
STUB_CHECKS='[{"name":"t","bucket":"pending"}]' STUB_CHECKS_RC=8 expect "pending, gh exit 8" 1 "t=pending" o/r 7 $SHA
expect "short sha"  2 "40-character" o/r 7 abc123
expect "bad PR"     2 "digits"       o/r x $SHA
expect "bad repo"   2 "OWNER/REPO"   repo 7 $SHA
expect "repo with newline" 2 "OWNER/REPO" $'o/r\nx/y' 7 $SHA
expect "repo dot-dot" 2 "OWNER/REPO" ../.. 7 $SHA
# shellcheck disable=SC2016  # the literal text $(id) is the test input
expect "repo with shell syntax" 2 "OWNER/REPO" 'o/$(id)' 7 $SHA
STUB_CHECKS='[]' STUB_CHECKS_RC=1 STUB_CHECKS_ERR="no checks reported on the 'x' branch" expect "ready note says no checks" 0 "no checks were reported" --dry-run --allow-no-checks o/r 7 $SHA
expect "no args"    2 "usage"
[ "$fail" = 0 ] && echo "all passed"
exit "$fail"
