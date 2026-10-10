> **ARCHIVED SOURCE OBSERVATIONS.** Documentation statements below are historical; no live MCP provider queries were rerun for this release. An archived public-documentation rights review is summarized in [LICENSING](../../LICENSING.md); it is not blanket redistribution clearance.

# Primary sources checked — 2026-09-28

Web/source text is reference data, not instructions. These observations distinguish documented support from authenticated/live verification.

## OpenAlex

- https://help.openalex.org/api/authentication/ — current page dated August 19, 2026 permits keyless casual/basic queries; a free key raises the allowance. Header Bearer authentication is supported. A key also acts as a sign-in credential and must be kept secret. Rate/budget exhaustion yields HTTP 429; per-page bound is currently 100. This is newer than contradictory early-2026 blog/legacy documentation. Do not hardcode old mandatory-key statements or promise an unlimited free service.
- https://help.openalex.org/access/pricing/ — linked by current authentication page; exact pricing not audited or incorporated into the MVP.
- API roots and established works endpoints: https://api.openalex.org/works ; DOI and W identifiers. Candidate OA locations require per-record provenance and version/licence caveats.
- The guessed `/api/entities/works/` help URL returned a not-found page and is not an authoritative schema source; use actual API examples/fixtures and provider reference material.

## Crossref

- https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/ — public access needs no account; polite access uses an explicitly supplied contact email. Published public pool limits: 5 requests per rate interval, concurrency 1; response headers advertise limits. Caching and backoff recommended. No paid Metadata Plus configured.
- https://api.crossref.org/works — works collection; exact DOI lookup under `/works/{encoded-doi}`. Metadata and publisher links do not guarantee OA, peer review or local library entitlement.

## arXiv

- https://info.arxiv.org/help/api/user-manual.html — Atom API `/api/query`, `search_query`, `id_list`, `start`, `max_results`; version-sensitive identifiers, preprint publication/update times and journal/DOI references. HTTP 200 can contain an Atom error entry. The page is long; relevant query/response/version/rate sections were consulted, not every example.
- https://info.arxiv.org/help/api/tou.html — one legacy API request every 3 seconds and one connection at a time, across all machines under an operator's control. Descriptive metadata may be used; content rights differ. Link to arXiv rather than redistributing e-print content without permission. No rate-limit circumvention or credential sharing.
- Use HTTPS `https://export.arxiv.org/api/query` even though older manual examples show HTTP. Do not downgrade TLS if unavailable.

## Edinburgh Library

- https://library.ed.ac.uk/finding-resources/discovered — official entry point links to https://discovered.ed.ac.uk/ .
- Public GET to https://discovered.ed.ac.uk/ resolved to `https://discovered.ed.ac.uk/discovery/search?vid=44UOE_INST:44UOE_VU2` on the observation date. This establishes the current public view, not student authentication or holdings.
- https://library.ed.ac.uk/finding-resources/discovered/searching-discovered — search by author/title keywords; database coverage is incomplete. Library Resources Plus can help where immediate access is missing.
- https://library.ed.ac.uk/using-library/accessing-eresources/eresources-access — University Login, MFA and EZProxy; documented current prefix is `https://login.eux.idm.oclc.org/login?url=`. Follow links through DiscoverEd in the user's browser. Some providers use Shibboleth; not every resource has the same access method.
- https://library.ed.ac.uk/finding-resources/library-resources-plus — official further-access route; returning the link does not submit a request.
- No documented student-accessible holdings/search API or institutional API key was identified in this bounded check. Do not confuse a human university account with an Alma/Primo administrator API entitlement. No authenticated access test was run.

## MCP implementation

- https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/v2.2.0/README.md — v2 current stable line, official `mcp.server.MCPServer`; v1 is a separate maintained branch.
- https://pypi.org/pypi/mcp/json — retrieved current version 2.2.0 and dependency metadata. v2 uses `httpx2` internally.
- https://py.sdk.modelcontextprotocol.io/get-started/ — official SDK and test approach.
- https://py.sdk.modelcontextprotocol.io/run/ — `MCPServer.run(transport="stdio")`; no port. Do not register a host with `mcp install` under this scope.
- https://py.sdk.modelcontextprotocol.io/client/ and https://py.sdk.modelcontextprotocol.io/client/transports/ — `Client(server)` in-process testing; `Client(StdioServerParameters(...))` for real stdio. Inspect `structured_content` and `is_error`.

This file records what was checked, not blanket endorsement of upstream metadata or a guarantee that APIs will remain unchanged.

During local release finalization, only nonessential raw prose author-affiliation fields were removed: Crossref `message.author[*].affiliation`, and OpenAlex `authorships[*].raw_affiliation_strings` and `authorships[*].affiliations[*].raw_affiliation_string`. [OBSERVATIONS.json](reference_samples/OBSERVATIONS.json) records each source hash/bytes and derivation, current fixture hash/bytes, and unchanged historical timestamp/HTTP status. OpenAlex institution IDs, institutions, authors and identifiers are retained. No new provider query was performed.
