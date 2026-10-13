# Source of truth

The user authorized publication of the reviewed Research MCP component to `Originium-Project/originium-open` on 2026-10-10. The public repository is canonical for this published release only; it does not migrate the active private source or any client configuration and does not activate a mirror.

The selected source is `4aefd8ae0ab6460a671a0ce774fc0abc585ce9a0`. The [manifest](../release-manifest.json) records 22 frozen payloads: 18 byte-identical source imports and four explicit derived payloads (PEP 639 license metadata, sanitized Crossref fixture, sanitized OpenAlex fixture and updated observation provenance). Both provider fixtures only had nonessential raw prose affiliation fields removed; no new provider query was made. Hashes are identity evidence, not rights or security clearance.

Preexisting private uncommitted changes to `transport.py` and `test_transport_service.py` are excluded and retained untouched in the private legacy work. The original runtime, all 55 component tests, integration script, template and lock are unchanged. No private history or client state is exported; the first public commit must have no parent.

Future component tags such as `research-mcp/vX.Y.Z` remain a proposal. Private consumers may migrate only through a separately scoped decision; no source-of-truth or client migration is claimed here. Each later component needs its own ownership, scope, licensing, tests and release review.


## Maintenance and reviewed transfer

Research MCP's maintained development source remains the active private `research-mcp` project. `projects/research-mcp` here is the reviewed public delivery copy; this repository is authoritative for the bytes it ships. Publication did not move development, retire the private source, migrate consumers or create automatic synchronization. Originium Project maintainers own dependency updates and reconciliation in both contexts; the maintainer preparing a patch must record its source revision and destination review before release.

For each change, use this reviewed export/backport process:

1. Develop and test in the maintained source. Select an explicit component-only patch or payload list; do not copy private history, local configuration or unrelated uncommitted work. A public-first fix must also receive a tracked backport to the maintained source, with conflicts reviewed explicitly.
2. Prepare a local export with source revision, changed paths and hashes, derivations, dependency/license changes, and destination revision. Preserve the original release receipt. Any new delivery receipt must describe the new payload and receive its own catalog review; never rewrite the historical hashes to make a check pass.
3. Run the same component suite in both sources, including `tests/test_protocol.py::test_real_stdio_local_only`. Run the public `scripts/check-local.sh --current-tree` after the reviewed inventory update. Record results for the support matrix below and review the export diff for private-only material.
4. Resolve differences or record an explicit deferred backport before requesting release approval. Publishing, component tags, consumer migration and synchronization remain separately authorized actions. A passing local check is not release approval.

## Runtime and dependency acceptance

| Runtime / delivery | Declared scope | Evidence required for the next release |
|---|---|---|
| CPython 3.11 on Linux | Lowest declared Python (`>=3.11`) | Component suite, offline wheel build, clean wheel install and installed-entry-point stdio smoke |
| CPython 3.14 on Linux | Current target; historical observations exist | The same checks against the same reviewed dependency artifact set |
| Other Python versions, operating systems and MCP clients | Not removed from existing declarations; not verified here | Explicit compatibility evidence before claiming tested support |

No CI workflow is present in this public tree. The private workflow mentioned in the maintenance review is outside this checkout. These rows are required acceptance evidence, not a claim that a matrix has run. Keep the MCP SDK for protocol and stdio support. Run source tests in both delivery contexts; additionally smoke-test the built wheel with source imports disabled so source-tree success cannot conceal a broken package. See [dependency policy](../projects/research-mcp/DEPENDENCIES.md) for the hash-lock decision and current limitations.
