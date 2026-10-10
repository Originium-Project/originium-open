# Source of truth

The user authorized publication of the reviewed Research MCP component to `Originium-Project/originium-open` on 2026-10-10. The public repository is canonical for this published release only; it does not migrate the active private source or any client configuration and does not activate a mirror.

The selected source is `4aefd8ae0ab6460a671a0ce774fc0abc585ce9a0`. The [manifest](../release-manifest.json) records 22 frozen payloads: 18 byte-identical source imports and four explicit derived payloads (PEP 639 license metadata, sanitized Crossref fixture, sanitized OpenAlex fixture and updated observation provenance). Both provider fixtures only had nonessential raw prose affiliation fields removed; no new provider query was made. Hashes are identity evidence, not rights or security clearance.

Preexisting private uncommitted changes to `transport.py` and `test_transport_service.py` are excluded and retained untouched in the private legacy work. The original runtime, all 55 component tests, integration script, template and lock are unchanged. No private history or client state is exported; the first public commit must have no parent.

Future component tags such as `research-mcp/vX.Y.Z` remain a proposal. Private consumers may migrate only through a separately scoped decision; no source-of-truth or client migration is claimed here. Each later component needs its own ownership, scope, licensing, tests and release review.
