# Licensing

On 2026-10-10 the user declared the copyright name **Originium Project contributors**, ownership of the original code, and authority to release it under MIT. The [root LICENSE](LICENSE) and [component LICENSE](projects/research-mcp/LICENSE) grant MIT for project-original software and associated documentation, copyright (c) 2026 Originium Project contributors. Component metadata declares the SPDX expression `MIT` and the license file using PEP 639.

The user authorized publication of the reviewed Research MCP component to `Originium-Project/originium-open`. This grant does not establish rights over third-party material; release approvals are recorded separately in the [manifest](release-manifest.json). MIT does not cover provider fixture data, dependency code or full papers. Preserve applicable upstream terms and notices.

[Dependency metadata](projects/research-mcp/DEPENDENCIES.md) is preliminary installed metadata, not a complete obligation analysis. For the current unbundled, source-only form no concrete dependency-distribution blocker was identified, but that is not formal clearance. Provider-field rights and dependency obligations are tracked in the [release checklist](docs/RELEASE-CHECKLIST.md). No dependency binaries are vendored. No complete legal or security audit is claimed.

## Provider data and third-party scope

Archived official-source review supports the following distinctions, not blanket legal clearance:

| Material | Documented scope | Remaining constraint |
|---|---|---|
| Crossref bibliographic metadata | [Metadata licensing](https://www.crossref.org/documentation/retrieve-metadata/) describes most facts as public-domain/CC0. | Abstracts retain publisher/author rights. The fixture has no abstract; its nonessential prose affiliation biography has been removed. [Provenance](projects/research-mcp/reference_samples/OBSERVATIONS.json) retains original hash/bytes and historical HTTP data alongside the sanitized file hash/bytes. No new query was made. |
| arXiv descriptive metadata | [API terms](https://info.arxiv.org/help/api/tou.html) expressly include titles, abstracts, authors, identifiers and classifications under CC0. | E-print/PDF/source redistribution is separate; links do not grant content rights. No arXiv endorsement is claimed. |
| OpenAlex metadata | The fully read [API reference](https://help.openalex.org/api/) states that API data is CC0; the official [snapshot license](https://openalex.s3.amazonaws.com/LICENSE.txt) supplies CC0 1.0 terms. | CC0 addresses the affirmer's rights, not all third-party, trademark or patent rights. These metadata statements do not establish permission to redistribute linked full texts. Raw prose author-affiliation fields were removed from the fixture as routine rights minimization; structured institution IDs, institutions, authors and identifiers are retained. [Provenance](projects/research-mcp/reference_samples/OBSERVATIONS.json) records the original hash/bytes; no new query was made. |
| pathspec dependency | [MPL 2.0](https://www.mozilla.org/en-US/MPL/2.0/) applies to covered files; using an unbundled dependency differs from redistributing it. | If vendored, modified or distributed, retain notices and satisfy covered-source obligations. New original files are not automatically MPL merely because they use it. |

MIT is granted for eligible project-original software and documentation only; it does not assert ownership of provider records, dependency code or full papers. Where applicable, public-domain data remains public-domain; no blanket public-domain status is asserted for every fixture field. Applicable third-party terms/notices remain independent. Dependencies are not vendored in this repository. The 38-entry lock and declared license metadata are not a package-integrity or complete obligation audit.

The root and component LICENSE files contain the standard [SPDX MIT text](https://spdx.org/licenses/MIT.html), including the required copyright and permission notices. Hashes establish byte identity, not legal or security clearance.
