# Originium Research MCP — local MVP

2026-09-28. Scope: a reusable research MCP combining OpenAlex, Crossref, arXiv and a University of Edinburgh Library browser hand-off. Local Pi integration has been verified; see PI-SETUP.md. Source publication is separate from service deployment. Remote hosting, purchases and university-account automation are out of scope.

## Purpose and boundaries

Expose a small Python stdio MCP server using the official MCP Python SDK 2.2.0. No listening network server. Search and metadata queries go only to fixed public provider endpoints. The output is evidence-bearing metadata, not a claim of paper quality, peer review, authenticated entitlement or full-text reading.

Edinburgh integration is deliberately a **browser hand-off**, not a holdings API. Its official library pages direct students to DiscoverEd and University Login/EZProxy with MFA. The MCP constructs DiscoverEd search links and returns official access/help links. It does not collect passwords/cookies, automate sign-in, submit requests or assert that a subscription covers an item. Do not wrap arbitrary supplied URLs in a university proxy.

No automatic PDF retrieval, arbitrary URL fetch, file import, corpus ingestion, citation graph crawl or paid provider tier in this MVP. Those need separately reviewed scope. Open-access links are reported candidates, not verified downloads or redistribution licences.

## Tools

1. `search_papers(query, sources?, limit=5)`: search selected OpenAlex/Crossref/arXiv providers, bounded to 1–10 results per provider and three providers. Return provider-labelled records and explicit partial failures. Query syntax differs by provider; no claim of common global relevance ranking. Literal-text query by default; do not silently interpret user text as arXiv Boolean grammar.
2. `lookup_paper(identifier)`: DOI -> Crossref; OpenAlex W ID -> OpenAlex; versioned/legacy arXiv ID -> arXiv. Canonical known-provider URL forms may be normalized; no arbitrary URL requests. Unknown DOI registration agency is an explicit Crossref lookup limitation.
3. `find_access(doi?, arxiv_id?, title?)`: collect reported OA/arXiv candidates plus publisher landing and Edinburgh hand-off links as appropriate. Metadata links do not establish permission or entitlement. Preserve candidate version, licence (possibly unknown), provider and retrieval time.
4. `edinburgh_access(doi?, title?)`: local deterministic DiscoverEd search links plus official help/Library Resources Plus links; no external request or browser launch.
5. `provider_status()`: supported capabilities, limits and configuration presence only. No secrets or contact email values.

Provide standard typed MCP input schemas, read-only/non-destructive annotations where supported, bounded strings/results, structured outputs and a source-content-is-untrusted warning. Tool failure must never masquerade as an empty successful search.

## Record contract

Each record retains source, source ID, canonical DOI/arXiv identifiers when known, title, authors, available dates (online/print/preprint update distinguished), source-reported publication type, journal reference if present, version/relationship evidence, safe landing/PDF candidates and retrieval timestamp. Unknowns stay null/unknown. A DOI or journal-article type does not prove peer review. arXiv records remain preprints even if they report a published DOI.

Exact DOI matches may be **grouped**, but preserve the individual source/version records. Do not fuzzy-merge titles or erase conflicting metadata. If no identifier equivalence is known, retain separate records. Return identifier-grouping limitations explicitly.

## Transport and privacy

- Fixed HTTPS API origins: `api.crossref.org`, `api.openalex.org`, `export.arxiv.org`; fixed paths and encoded parameters/identifiers. No custom base URLs through MCP input.
- Disable ambient proxy/credential inheritance in HTTP clients (`trust_env=False`); TLS verification on; no redirects; no university authentication.
- Per-provider serialization, conservative intervals (at least 3 seconds for arXiv, 1 second for the other providers), bounded response bytes, input lengths, field lengths, timeouts and concurrent work. Honor 429/503 Retry-After as a cooldown; no automatic retry loop.
- Bound in-memory TTL cache; arXiv recommends repeated-query caching for a day. Cached records retain the original retrieval time and expose cache status.
- The MVP is one MCP process per operator; arXiv's rate rule applies across all machines/processes, not just this application. Do not run independent replicas without a shared limiter. The POSIX stdio launcher takes an exclusive lock in a private per-operator state directory; different directories/machines are not coordinated.
- Optional `OPENALEX_API_KEY` is provided through environment only and sent only to OpenAlex as a Bearer header. Current official docs permit keyless casual access. Never print headers, key-bearing URLs, response bodies from errors, or exception strings that may contain secrets. No paid escalation.
- Optional `RESEARCH_CONTACT_EMAIL` is explicitly configured, not inferred from local identity; sent only to providers as documented contact metadata. Explain this disclosure.
- Provider text is untrusted data. Normalize text safely, reject dangerous/non-web/userinfo URL candidates, and use a hardened XML parser for arXiv. Never execute source content.

## Validation

Offline tests use synthetic/recorded public fixtures: identifiers and URL encoding; Crossref/OpenAlex JSON; arXiv XML/error entries, versions and missing fields; OA versus unknown-access distinctions; exact-ID grouping without version loss; partial provider outages; response size bounds, redirects, timeouts, cache timestamps, rate/cooldown behavior; secret-safe failures; no university requests; official SDK in-memory and real stdio tool discovery/calls. Network-disabled, sanitized, resource-bounded sandbox for target tests. Parent may separately collect a few public API response samples using trusted tooling; no authenticated library probe.

Historical upstream review status (2026-09-28): independent review was attempted but did not complete then. Later bounded release reviews do not establish comprehensive independent security clearance. Maintainer review, tests and live protocol/provider observations are recorded separately in VALIDATION.md. No broad security-audit claim, inferred institutional entitlement or assumed remote deployment.

## Deferred

Other-client compatibility checks; optional free OpenAlex key setup; authorized university API only if library supplies/documentation confirms availability; bounded public PDF downloader with SSRF/redirect/size/rights/provenance controls; local user-supplied PDF import; durable library/BibTeX export; shared cross-client rate service. Trading-engine implementation is outside this utility's scope.
