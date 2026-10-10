# Originium Research MCP

**MIT for project-original software and documentation. Release approvals are recorded in the [manifest](../../release-manifest.json), not in this README.**
Copyright (c) 2026 Originium Project contributors, declared and authorized by the user on 2026-10-10.
See [LICENSING](../../LICENSING.md) and [release gates](../../docs/RELEASE-CHECKLIST.md).
Historical observations below are archived evidence, not fresh validation.


A local **stdio MCP server** for scholarly discovery using **OpenAlex, Crossref and arXiv**, with a **University of Edinburgh Library browser hand-off**.

It searches metadata and reports access candidates. It does **not** authenticate to a university, check subscription holdings, download PDFs, read full papers, or validate research findings.

## Install and run

Requires Python **3.11+** and POSIX `flock`; Linux with Python **3.14** is the tested platform. From the monorepo root, enter the full component directory before creating its virtual environment:

```bash
cd projects/research-mcp
python3 -m venv .venv
.venv/bin/python -m pip install --only-binary=:all: -r requirements.lock
PYTHONPATH="$PWD/src" .venv/bin/python -P -m originium_research_mcp
```

The last command starts a **stdio protocol process**, not an interactive shell or HTTP server. Normally an MCP client launches it. Without client messages it waits on stdin; use Ctrl-C to stop a manual launch. Nothing is registered automatically.

The lock file pins the tested runtime and development dependency versions. It is not a hash-verified supply-chain guarantee. No system Python installation is changed.

For a console entry point, an optional local installation after installing the lock is:

```bash
.venv/bin/python -m pip install --no-deps --no-build-isolation -e .
```

This enables `.venv/bin/originium-research-mcp`. The source-based command above does not require it.

## Connect to Pi

See **[PI-SETUP.md](PI-SETUP.md)** and [example-client-config.json](example-client-config.json). The example contains placeholders, not a working machine's configuration. Merge the `research` entry into your own Pi MCP configuration; do not overwrite other servers.

Use manual startup to avoid conflicting instances:

```text
/reload
/mcp:start research
```

Run `/mcp research` to check for `State: ready`. Reloading stops the server, so do not reload again immediately after starting it.

## Tools

| Tool | Purpose |
|---|---|
| `search_papers(query, sources?, limit=5)` | Search 1–10 records **per provider**, up to three providers. No common cross-provider relevance ranking. arXiv searches literal words, not caller Boolean/field syntax. |
| `lookup_paper(identifier)` | DOI → Crossref; W ID → OpenAlex; modern/legacy arXiv ID → specified version, or latest when no version is given. Crossref does not cover every DOI agency. |
| `find_access(doi?, arxiv_id?, title?)` | Reported access links, provenance, partial errors and an Edinburgh hand-off. Title-only results are **candidate identities**, not confirmed matches. |
| `edinburgh_access(doi?, title?)` | Construct official DiscoverEd/help/Library Resources Plus links locally. No external request, sign-in or holdings claim. |
| `provider_status()` | Capabilities, limits and configuration-presence booleans. **Not** an upstream health check. |

Examples:

```json
{"query":"cryptocurrency momentum","sources":["crossref","arxiv"],"limit":2}
```

```json
{"doi":"10.2469/faj.v58.n4.2453"}
```

Use the second with `find_access` or `edinburgh_access` for Lo's *The Statistics of Sharpe Ratios*. Open the returned DiscoverEd link yourself and complete University Login/MFA in your browser if prompted. Resources Plus is a link, not an automatically submitted request.

## Optional configuration

| Environment variable | Effect |
|---|---|
| `OPENALEX_API_KEY` | Optional Bearer key sent **only to OpenAlex**. Current docs permit some keyless use; search can still be rate-limited. No paid tier is enabled automatically. |
| `RESEARCH_CONTACT_EMAIL` | Explicit contact sent **only to Crossref** as User-Agent metadata. Leave unset to avoid this disclosure. |
| `RESEARCH_MCP_STATE_DIR` | Private absolute directory for an instance lock; defaults to `~/.cache/originium-research-mcp`. No queries or credentials are persisted there. |

These apply to direct launches. The supplied **Pi example uses `env -i` and starts anonymously**: exporting a key in Pi's parent environment will not forward it. Optional-key setup needs a separately reviewed, secret-safe forwarding mechanism. Never put credentials in command arguments, chat, checked-in configuration or URLs. Ambient HTTP proxy settings are not used.

## Interpret metadata, not guarantees

- Records from different sources/versions remain separate. Equal DOI grouping keys indicate reported relationships, not interchangeable texts. No fuzzy title deduplication.
- Print/online dates are distinct. arXiv publication/update dates and `vN` are preserved; a journal DOI does not turn an arXiv record into a final published manuscript.
- Same-record arXiv content links are version-pinned. Related journal links are not labelled as preprint content.
- OA/licence/version fields are provider reports; unknowns remain unknown. Publisher/TDM links are not presumed OA. A link is not permission to download, reuse or redistribute content; `journal-article` does not prove peer review.
- Authors are bounded to30 with a truncation warning. Provider text is bounded, untrusted data, never instructions.
- Cached records retain the original `retrieved_at` time and set `cached=true`.
- Check application `status` and `errors`. An MCP protocol success can carry a provider failure. Mixed useful results/failures report `partial` instead of pretending to be an empty successful search.

## Operational bounds

Only three fixed HTTPS API origins are contacted. Redirects are refused; there is no arbitrary-URL fetch or PDF downloader. Responses are limited to2MiB. Identity encoding is requested and unsolicited compression refused. Each request has a15-second deadline including queued waits.

Each provider is serialized: ≥3seconds between arXiv request starts, ≥1second for the others. HTTP429/503 cooldowns honor Retry-After with no automatic retries. The in-memory cache is bounded to128 entries/16MiB, with arXiv24-hour and other-provider1-hour TTLs.

**Run one instance per operator**, using one state directory. The launcher lock does not coordinate other directories, machines or separate API clients. arXiv's policy applies across all your use: do not run independent replicas or restart to evade pacing. Shared multi-client service operation is outside this MVP.

## Development and evidence

- [DESIGN.md](DESIGN.md): architecture and scope.
- [SOURCES.md](SOURCES.md): official documentation and dated observations.
- [VALIDATION.md](VALIDATION.md): historical tests, live observations and review limits.
- [CONTRIBUTING.md](../../CONTRIBUTING.md): contribution and publication rules.

With local dependencies installed and Bubblewrap supporting bounded tmpfs (`--size`; version0.11.0 tested), run the network-disabled suite:

```bash
scripts/check-local.sh --require-approved
```

This command verifies an approved Git checkout. For a partially approved local candidate, omit `--require-approved`; the default mode deliberately requires pending approval.

The optional Pi integration check needs separately installed Pi components; see [integration/README.md](integration/README.md). Normal unit tests do not run live provider queries. This repository provides no activated or remotely verified CI. Do not confuse discovery infrastructure with a completed literature review or a replicated research result.

Automatic full-text retrieval, authenticated library APIs, durable citation libraries/export, shared hosting and trading functionality are deferred. The user authorized publication to `Originium-Project/originium-open`; the [release checklist](../../docs/RELEASE-CHECKLIST.md) lists the required verification and post-publication review. This component deploys no service.
