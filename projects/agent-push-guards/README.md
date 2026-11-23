# Agent push guards

A `pre-push` hook and one helper script for machines where several coding agents share one checkout and one set of Git credentials. Plain Bash and Git; the lock part needs `flock` and `/proc` (Linux).

What goes wrong without it: an agent session whose shell lacked its identity variables commits under the machine's personal address and pushes it; an agent pushes a commit that is not the checkout's HEAD, so the tests that ran were not the tests of what was pushed; two agents run full test suites at once and the machine swaps; someone force-pushes the main branch.

For every pushed ref the hook, in this order:

1. **Identity** (`check-identity.sh`): refuses new commits (those on no remote yet) whose author or committer address does not match `PUSH_GUARD_ROLE_PATTERN` (a shell glob, default `*@users.noreply.local`). Look-alike domains such as `agent@users.noreply.local.example.com` do not match. Merge commits that the hosting service wrote under a person's account are not "new" once main is fetched, so a branch that merged main passes.
2. **Protected branch**: refuses deleting it, and refuses a non-fast-forward push to it (`PUSH_GUARD_PROTECTED_BRANCH`, default `main`) unless `PUSH_GUARD_ALLOW_FORCE=1`.
3. **Scan** (optional): runs `$PUSH_GUARD_SCAN <range>` and blocks the push if it fails (for example a secret scanner). The range is one argument, a `git rev-list` expression.

Then, if the repository has a `package.json` (and `PUSH_GUARD_SKIP_TESTS` is not `1`):

4. **Clean HEAD**: every pushed commit must be this checkout's HEAD and the checkout must have no uncommitted changes, because the tests run on the checkout.
5. **One suite at a time**: the test command (`PUSH_GUARD_TEST_COMMAND`, default `npm test`) runs while holding a machine-wide `flock` (`PUSH_GUARD_SUITE_LOCK`, default `~/.cache/push-guard-suite.lock`). If another suite holds it, the hook says so and waits up to `PUSH_GUARD_SUITE_LOCK_WAIT` seconds (default 5400). If an ancestor process (for example a parent that already queued for the lock) holds it, the hook does not lock again, so it cannot deadlock against its own parent. The test processes do not inherit the lock descriptor. The log of a failing run is kept and its tail printed.

A person pushing their own commits sets `PUSH_GUARD_OWNER_PUSH=1` to skip the identity check; that is theirs to set, never an agent's.

## Install

```sh
git config core.hooksPath path/to/agent-push-guards   # the directory that holds pre-push and check-identity.sh
```

Agents then commit with a role identity, for example `git -c user.name=agent-1 -c user.email=agent-1@users.noreply.local commit ...`. Keep the two scripts together, or set `PUSH_GUARD_DIR`.

## Tests

```sh
node --test tests/*.mjs
bash tests/check-identity.test.sh
```

Offline; they use throwaway repositories with a bare remote as the "hosting service". The `.mjs` tests use only built-in Node modules (tested on Node 24) and skip when `flock` or `/proc/self/fdinfo` is missing. Covered: the identity cases above, the custom pattern, the scan argument and failure, the clean-HEAD refusals, and the lock (queueing, waiting message, ancestor-held lock, no descriptor inheritance, the skip switch). Not covered: macOS and Windows.

## License

MIT, copyright (c) 2026 Originium Project contributors; see [LICENSE](LICENSE). No third-party code is bundled.
