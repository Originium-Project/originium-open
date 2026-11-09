# exact-head-merge

`merge-exact-head.sh` merges a GitHub pull request only if it is exactly the commit your tests ran on, and otherwise prints one `REFUSED:` line (or, for a failed lookup, an error on stderr).

## Why

A chained "run tests, push, wait for CI, merge" command can merge the wrong commit without any error. If the push step silently does not happen (for example because it is gated on parsing the test log), the pull request still holds the previous head, the CI wait passes on that old head, and the merge goes through. A pull request that shows `CLEAN` can also be behind its base branch when the repository does not require branches to be up to date. The fix that ships afterwards then needs a second pull request.

## What it checks

Before it merges, the script requires all of these:

1. the pull request is open;
2. its head commit equals the full commit id you pass in (the one the tests ran on);
3. that head already contains the base branch (zero commits behind);
4. every check on that head has finished and none failed. No checks at all is refused, unless you pass `--allow-no-checks`.

Then it runs `gh pr merge PR --merge --match-head-commit SHA`, so GitHub itself also refuses if the head moved between the check and the merge.

## Use

```sh
H=$(git rev-parse HEAD)          # the commit the tests ran on
# ... run the tests on $H, push $H ...
./merge-exact-head.sh --dry-run OWNER/REPO 123 "$H"   # verdict only
./merge-exact-head.sh OWNER/REPO 123 "$H"             # merge if ready
```

Exit status: `0` ready (dry run) or merged, `1` refused (the reason is on the line that starts with `REFUSED:`) or the merge command itself failed, `2` bad usage or a lookup that failed (including a failed check lookup).

`MERGED:` means `gh` accepted the merge request; on a repository with a merge queue the pull request may be queued rather than merged yet. Needs the GitHub CLI (`gh`, signed in) and `jq`. The merge method is a merge commit; change the one `gh pr merge` line for another method.

## What it does not do

It does not support base branches whose name contains a slash (the comparison lookup is expected to fail, and then the script exits 2 without merging; it was not tested against GitHub). It checks that the head is current with the base branch once, before it merges; `--match-head-commit` pins only the head, so a push to the base branch between that check and the merge is not caught. It does not run your tests, re-run checks, resolve conflicts, or change any repository setting. It does not replace branch protection; it gives anyone with merge rights the same answer without needing admin settings.

## Tests

`tests/test-merge-exact-head.sh` runs the script against a stub `gh` (no network). It covers a ready pull request, a merge that pins the head, a moved head, an already merged pull request, a head behind its base, failed, pending and missing checks, and bad arguments.

## License

MIT, copyright (c) 2026 Originium Project contributors. See [LICENSE](LICENSE).
