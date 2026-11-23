# Temp-root runner

One Node file (`temp-root.mjs`, built-in modules only; tested on Node 24) that runs any command with its own temporary directory as `TMPDIR` and removes that directory when the command ends, so a test run leaves nothing behind.

```sh
node temp-root.mjs npm test
node temp-root.mjs python3 -m unittest discover
KEEP_TEMP_ROOT=1 node temp-root.mjs ./run-suite.sh   # keep the root to look at it afterwards
```

What it does:

- **A private root per run.** The child's `TMPDIR` is a fresh directory; nothing else in `/tmp` is touched.
- **Removed on every way out.** On normal exit, on a non-zero exit, and on SIGINT, SIGTERM or SIGHUP sent to the runner. A mode 000 folder left by a test is unlocked before removal.
- **Short root, on disk.** Unix socket paths are limited (`sun_path` is about 108 bytes) and tools often put sockets under `TMPDIR`. The root is made in the caller's `TMPDIR` only if that keeps the root at most 15 bytes; otherwise it is `/var/tmp/XXXXXX`, on disk rather than in a RAM-backed `/tmp`. If `/var/tmp` cannot take it, the caller's `TMPDIR` is used.
- **Honest exit status.** The child's exit code, else 128 plus the signal number. A first signal is forwarded to the child; a second one kills it, so the runner can always end and clean up.

`makeRoot()` and `runWithTempRoot()` are exported for use from a script.

## Tests

```sh
node --test tests/temp-root.test.mjs
```

Eight offline tests: own `TMPDIR` and removal, exit code, `KEEP_TEMP_ROOT=1`, a locked folder, a long `TMPDIR`, the root choice, SIGTERM forwarding, usage. Linux and macOS paths (`/tmp`, `/var/tmp`) are assumed.

## License

MIT, copyright (c) 2026 Originium Project contributors; see [LICENSE](LICENSE). No third-party code is bundled.
