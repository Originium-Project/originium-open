> **ARCHIVED EVIDENCE.** Imported historical observations below were not rerun for this release. They do not establish current availability, entitlement, release clearance or successful local checks. See the [release checklist](../../docs/RELEASE-CHECKLIST.md) for required validation.

# Validation — 2026-09-28

## Automated coverage

The initial implementation passed **52 offline tests** on Python3.14.7 with MCP SDK2.2.0. Publication preparation adds three checks for the portable Pi template, local-state exclusions and documentation links. The resulting **55-test suite passed in1.09seconds** under the network-disabled sandbox during historical upstream preparation; this is not a fresh result for this repository or evidence of publication.

Coverage includes:

- in-memory and real-stdio MCP discovery, structured results, input bounds, annotations and lifecycle cleanup;
- Crossref/OpenAlex JSON and arXiv Atom parsing against synthetic/recorded public samples, with fixture hashes verified;
- DOI URL/percent/reserved-character handling; modern/legacy/latest/exact-version arXiv identifiers; publication/update timestamps;
- separate source records with DOI grouping, preprint versus related-journal links, reported OA/licence/version unknowns, author truncation;
- partial failures, malformed JSON/XML/entity rejection, response bounds, redirects, timeouts, serialized pacing, day-long cooldown, cache TTL/capacity/original timestamps;
- safe header scoping/errors, local-link rejection, no university network calls, instance-lock/symlink behavior.

`pip check` and an offline wheel build also passed for the original runtime. Wheel contents/entry-point were inspected; no tests, reference samples or `.pth` files were included. The dependency lock is a version snapshot, not a package-integrity audit.

For an approved Git checkout run the current suite with `scripts/check-local.sh --require-approved`; omit the flag only for a partially approved local candidate. It uses an empty allowlisted environment, isolated network/PID/user namespaces, read-only source/toolchain and populated `/dev`, and scratch-only writable regular-file storage within a128MiB total tmpfs budget, with 2GiB address-space/90CPU-second/64-process/256-file-descriptor/16MiB-file/120-second wall limits for target execution. (The separate host-side Git-projection launcher used by `--require-approved` has no process-count limit, since `RLIMIT_NPROC` is host-user-wide; see [SECURITY](../../SECURITY.md).) Scratch and generated files are discarded. Dependencies must already be available; tests do not fetch them. Operator-only notes and client configuration are masked. **Historical UPSTREAM observation:** upstream Git hooks scanned staged/outgoing changes and ran the suite before push. This repository has no activated Git hooks; future automation is subject to the [release checklist](../../docs/RELEASE-CHECKLIST.md).

## Pi integration observations

The installed Pi0.87.1 / `pi-mcp-extension`1.5.0 manager, configuration parser and tool bridge were exercised in an isolated standalone check with captured registration hooks. Five tools were discovered, JSON results parsed, invalid limits rejected by the server, and clean shutdown/lock release verified. A dummy parent key was not inherited, and a fake package in the caller's working directory did not shadow the configured source.

Subsequently, **all five real `mcp_research_*` tools became available and were called directly in an actual Pi chat**. This confirmed activation, not just standalone protocol compatibility. The optional script in [integration/](integration/README.md) documents the reproducible boundary; no operator's live client configuration is included in this repository.

## Live public data observations

These were bounded, operator-approved public metadata queries, separate from network-disabled unit tests:

| Check | Observed result |
|---|---|
| Crossref search, `cryptocurrency momentum` | *Cryptocurrency Momentum and Reversal*, DOI `10.2139/ssrn.3913263` |
| arXiv search, same query | *Momentum and liquidity in cryptocurrencies*, ID `1904.00890v1` |
| OpenAlex anonymous search | HTTP429; correctly reported as a partial provider failure. A bounded follow-up after the cooldown was also rate-limited. No unlimited retry loop. |
| DOI access discovery | Crossref **and OpenAlex** returned separate records for Lo's *The Statistics of Sharpe Ratios*, DOI `10.2469/faj.v58.n4.2453`, plus source links and the Edinburgh hand-off. |
| Crossref DOI lookup | One initial timeout; a later access-discovery retrieval succeeded, and subsequent lookup reused its cache with the identical original retrieval time. |
| Edinburgh helper | Official DiscoverEd/help/Resources Plus links; entitlement explicitly unknown. No login, holdings query, request submission or PDF retrieval. |

Public reference GETs also returned200 from all three metadata APIs. Bounded JSON/XML samples, retrieval timestamps and hashes are in [reference_samples/OBSERVATIONS.json](reference_samples/OBSERVATIONS.json). They are static fixtures, not an availability guarantee, permission to redistribute full texts, or evidence of reading/replicating a paper.

## Review and deployment limits

**Historical upstream review status (2026-09-28):** maintainer source review and regression fixes were completed; independent model-review attempts timed out without a completed verdict then. This historical status is distinct from later release-specific reviews. Neither a timeout nor a bounded release review establishes a passed comprehensive independent audit or production clearance.

Optional-key accounts, authenticated university entitlement, interactive browser access, other platforms/clients and shared multi-client operation remain unverified. Publishing the source repository does not deploy a server or expand the institutional-access scope.

Machine-local operational notes, actual client configuration and virtual environments are excluded from Git. No credentials, private infrastructure or operator session logs belong in this repository. **Historical UPSTREAM observations:** upstream local pre-push scans included the operator's private-pattern list when available; upstream CI checked credentials and generic private-infrastructure patterns without receiving that private list. Neither hooks nor CI were imported here. This repository has no activated hooks or implemented/verified CI; the [release checklist](../../docs/RELEASE-CHECKLIST.md) describes a future plan. These historical observations confer no current security, legal or publication approval.

## Release checks

Current test results, privacy review, rights/dependency decisions and final review evidence are recorded by the release process in the [manifest](../../release-manifest.json), not claimed in this file. Licensing is MIT for project-original software/documentation by user declaration; this is not a security or third-party rights clearance. All 55 original component tests remain unchanged. Root regressions cover candidate state, the four documented derivations (including OpenAlex raw prose removal with unchanged parser output), and synthetic Git projections. Approved-commit validation runs through `scripts/check-local.sh --require-approved`: the host-side data-only launcher validates the source index and builds the projection, and the guard and tests then run confined. The projection preserves the exact current commit SHA without its parent objects; it checks the current commit only, not history.
