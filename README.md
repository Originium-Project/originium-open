# Originium monorepo

Project-original software and documentation are licensed under [MIT](LICENSE), copyright (c) 2026 Originium Project contributors. On 2026-10-10 the user declared ownership and authority for this grant and authorized publication of this component to `Originium-Project/originium-open`. This repository contains only [Research MCP](projects/research-mcp/README.md), imported from source revision `4aefd8ae0ab6460a671a0ce774fc0abc585ce9a0`. It is a bounded stdio scholarly metadata server; unknown metadata and partial provider errors remain visible.

It uses fixed API origins `https://api.openalex.org`, `https://api.crossref.org`, and `https://export.arxiv.org`. It does not offer arbitrary fetching, login, browser automation, PDF retrieval or trading. Historical fixtures and validation are recorded evidence, not current provider availability or institutional entitlement.

To install, start at the monorepo root:

```sh
cd projects/research-mcp
python3 -m venv .venv
# Dependency installation requires network access.
.venv/bin/python -m pip install --only-binary=:all: -r requirements.lock
```

Dependencies are not bundled. The client template's `/ABSOLUTE/PATH/TO/research-mcp` means the complete nested `projects/research-mcp` directory. Real client configuration stays private.

With dependencies already installed, run `scripts/check-local.sh` from the monorepo root. Alternatively select an existing, read-only virtualenv with `RESEARCH_MCP_VENV`. The runner requires Linux Bubblewrap with bounded tmpfs support and working namespaces; it has no unsandboxed fallback. It runs the structural guard, original offline tests and root guard tests. The default runner is for manifests that do not yet record all eleven gates as approved: it requires the expected pending-approval rejection and fails if approval is already recorded. Use `--require-approved` for an approved manifest.

`scripts/check-local.sh --require-approved` requires every gate and decision to be supported by evidence and the exact candidate to be committed. It has two parts:

- A small reviewed, data-only trusted launcher runs on the host, outside Bubblewrap. It verifies the actual HEAD, index and worktree, then builds a public-only Git projection in scratch space. The launcher never imports or executes repository Python code. It runs under address-space, CPU, file-descriptor, file-size and 60-second limits but has no process-count limit, because `RLIMIT_NPROC` counts all processes of the host user ID; it runs at most one Git child at a time.
- The structural guard and all tests run inside Bubblewrap, which receives only the projection as `.git`. Target execution keeps its own 64-process, network, read-only, environment and storage limits.

`--require-approved` proves the current HEAD, index and worktree only. It does not make commit history safe to push: the projection exposes the current commit object but allows it to have parents. Before the first publication, verify manually that the actual HEAD commit has zero `parent` headers, and push that exact verified SHA. Do not import any original private history. Direct host execution of the guard or tests is not the validation path. Structural success and hashes do not prove absence of secrets or rights clearance.

See [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [LICENSING](LICENSING.md), [release checklist](docs/RELEASE-CHECKLIST.md), and [source-of-truth policy](docs/SOURCE-OF-TRUTH.md). Each later component needs an independent scope, license, tests and release review.
