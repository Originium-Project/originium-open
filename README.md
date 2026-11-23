# Originium monorepo

Project-original software and documentation are licensed under [MIT](LICENSE), copyright (c) 2026 Originium Project contributors. On 2026-10-10 the user declared ownership and authority for this grant and authorized publication of Research MCP to `Originium-Project/originium-open`. The user separately authorized this curated Token Flow demo addition on 2026-10-12, the visual design skill addition on 2026-11-08, the exact-head merge and shell pitfalls additions on 2026-11-09, and on 2026-11-23 authorized weekly publication of non-sensitive additions, under which the isolated browser launcher, agent push guards and temp-root runner were added (see [LICENSING](LICENSING.md)). The [CHANGELOG](CHANGELOG.md) lists what changed and when.

| Component | Scope | Local checks |
|---|---|---|
| [Research MCP](projects/research-mcp/README.md) | Bounded stdio scholarly metadata server; unknown metadata and partial provider errors remain visible. Imported from revision `4aefd8ae0ab6460a671a0ce774fc0abc585ce9a0`. | `scripts/check-local.sh --current-tree` from the repository root. |
| [Token Flow demo](projects/token-flow-demo/README.md) | Runnable offline UI with deterministic synthetic usage, charts and tables; open `projects/token-flow-demo/index.html` directly. | In `projects/token-flow-demo`: `npm test` and `npm run check`; Node.js 18+, no installation. |
| [Visual design skill](projects/visual-design-skill/README.md) | Instruction-only Markdown skill with templates for planning and reviewing visual work in reports, web interfaces, GUI apps and terminals; no code. | Inventory and hash check in `scripts/check-local.sh --current-tree`. |
| [Exact-head merge](projects/exact-head-merge/README.md) | One Bash script that merges a pull request only if its head is the commit your tests ran on, is current with the base branch and has green checks; needs `gh` and `jq`. | `bash projects/exact-head-merge/tests/test-merge-exact-head.sh` (offline, stubbed `gh`). |
| [Shell pitfalls](projects/shell-pitfalls/README.md) | One Markdown page with six shell traps that turn a failure into a success, each with a reproduction run on bash and zsh. | Inventory and hash check in `scripts/check-local.sh --current-tree`. |
| [Isolated browser launcher](projects/isolated-browser-launcher/README.md) | One Node file that starts headless Chromium or Firefox for tests on a free port with a throwaway profile, a deadline on every wait and a guaranteed kill on exit; Firefox is driven over WebDriver BiDi with Chrome's protocol shape. No dependencies. | `node --test tests/launch.test.mjs tests/firefox.test.mjs` in the component directory (stand-in browsers; real-Firefox tests skip where none is installed). |
| [Agent push guards](projects/agent-push-guards/README.md) | A `pre-push` hook and identity check for a checkout shared by several coding agents: role-address commits only, clean HEAD, no force-push to the main branch, one test suite at a time under a file lock. Bash and Git; the lock needs Linux. | `node --test tests/*.mjs` and `bash tests/check-identity.test.sh` in the component directory. |
| [Temp-root runner](projects/temp-root-runner/README.md) | One Node file that runs a command with its own short `TMPDIR` and removes it on exit or signal. | `node --test tests/temp-root.test.mjs` in the component directory. |

The [legacy release manifest](release-manifest.json) remains an unchanged historical receipt for the original 44-path Research MCP release. The [current component catalog](component-catalog.json) scopes that inventory to Research MCP and includes the separate component inventories of the demo ([Token Flow demo](projects/token-flow-demo/component-manifest.json)), the [visual design skill](projects/visual-design-skill/component-manifest.json), the [exact-head merge](projects/exact-head-merge/component-manifest.json), the [shell pitfalls](projects/shell-pitfalls/component-manifest.json), the [isolated browser launcher](projects/isolated-browser-launcher/component-manifest.json), the [agent push guards](projects/agent-push-guards/component-manifest.json) and the [temp-root runner](projects/temp-root-runner/component-manifest.json). It pins all eight receipts and checks their payload hashes; new, missing or changed inventory fails. Catalog changes require review alongside any component addition. Historical approvals do not authorize additions, catalog changes or later publication. The demo's [source provenance](projects/token-flow-demo/SOURCE.md) and independent review remain separate.

Research MCP uses fixed API origins `https://api.openalex.org`, `https://api.crossref.org`, and `https://export.arxiv.org`. It does not offer arbitrary fetching, login, browser automation, PDF retrieval or trading. Historical fixtures and validation are recorded evidence, not current provider availability or institutional entitlement.

To install, start at the monorepo root:

```sh
cd projects/research-mcp
python3 -m venv .venv
# Dependency installation requires network access.
.venv/bin/python -m pip install --only-binary=:all: -r requirements.lock
```

Dependencies are not bundled. The client template's `/ABSOLUTE/PATH/TO/research-mcp` means the complete nested `projects/research-mcp` directory. Real client configuration stays private.

For the current eight-component tree, with Research MCP dependencies already installed and Node.js 18+ available, run this offline command from the repository root; it checks the inventory of all eight components and runs the Research MCP and Token Flow demo suites:

```sh
scripts/check-local.sh --current-tree
```

Select an existing, read-only virtualenv with `RESEARCH_MCP_VENV` if needed. The runner requires Linux Bubblewrap with bounded tmpfs support and working namespaces; it has no unsandboxed fallback and downloads nothing. It checks the current inventory and documentation links, runs the demo's test and JavaScript syntax commands, and runs the original Research MCP and root regression suites. The Research MCP and demo suites share the existing resource bounds and network isolation. The exact-head merge script, the isolated browser launcher, the agent push guards and the temp-root runner have their own offline tests, listed in the table above, which this command does not run. Passing this command grants no publication authorization.

The modes without `--current-tree` retain the historical release rules: `--require-approved` requires the exact original release inventory and a committed candidate; the default mode requires pending approval. These historical modes intentionally reject an expanded tree. `--current-tree` and `--require-approved` cannot be combined.

`scripts/check-local.sh --require-approved` requires every gate and decision to be supported by evidence and the exact candidate to be committed. It has two parts:

- A small reviewed, data-only trusted launcher runs on the host, outside Bubblewrap. It verifies the actual HEAD, index and worktree, then builds a public-only Git projection in scratch space. The launcher never imports or executes repository Python code. It runs under address-space, CPU, file-descriptor, file-size and 60-second limits but has no process-count limit, because `RLIMIT_NPROC` counts all processes of the host user ID; it runs at most one Git child at a time.
- The structural guard and all tests run inside Bubblewrap, which receives only the projection as `.git`. Target execution keeps its own 64-process, network, read-only, environment and storage limits.

`--require-approved` proves the current HEAD, index and worktree only. It does not make commit history safe to push: the projection exposes the current commit object but allows it to have parents. Before the first publication, verify manually that the actual HEAD commit has zero `parent` headers, and push that exact verified SHA. Do not import any original private history. Direct host execution of the guard or tests is not the validation path. Structural success and hashes do not prove absence of secrets or rights clearance.

See [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [LICENSING](LICENSING.md), [release checklist](docs/RELEASE-CHECKLIST.md), and [source-of-truth policy](docs/SOURCE-OF-TRUTH.md). Each later component needs an independent scope, license, tests and release review.
