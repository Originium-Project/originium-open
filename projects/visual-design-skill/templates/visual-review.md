# Visual review template

Record actual evidence and violations **before** making visual edits. A screenshot-only verdict is provisional; no screenshot or exported page means no claimed visual pass. Unknown and not tested are distinct from pass and justified N/A.

## Evidence

- Artifact path/link or capture ID; revision/commit (if known):
- Medium; actual renderer/browser/terminal/PDF viewer and version (if known):
- Date; viewport/page size or terminal cells; zoom/print scale:
- Theme, locale, content/data state, input mode:
- Capture opened and inspected? yes/no; pages/views and risky boundaries inspected:
- Source/data/permissions/privacy checks and separate numeric/semantic/keyboard/contrast tests:

## Violations observed before fixes

| Severity (blocker/major/minor) | Exact page/view/region/state | Principle and observation | User effect | Correction | Confidence/evidence | Recheck |
| --- | --- | --- | --- | --- | --- | --- |
| … | … | … | … | … | … | … |

Do not fill a row from expectation alone. Mark missing evidence below. Blockers include misleading data, clipped/unreadable essentials, unavailable required action/detail, and verified accessibility failure.

## Ratings

Scale: 0 missing/unusable; 1 serious faults; 2 mixed/needs work; 3 coherent/pass with small issues; 4 exemplary. Weights and heuristic acceptance come from [the standalone skill](../skills/visual-design/SKILL.md): hierarchy 20, grid/spacing 15, typography 15, density/disclosure 15, chart integrity 15, medium/responsive 10, identity/restraint 10. An absent chart may be justified N/A and removed from the denominator; unknown is never N/A.

Do not invent pixel-level facts. Rate only what the opened capture actually shows; mark unknown where evidence is missing. A single screenshot cannot establish tested responsive states; missing chart data access cannot confirm that marks match values.

| Dimension | Weight | Concrete checks | 3 = pass means | Signs requiring 0–2 |
| --- | ---: | --- | --- | --- |
| Hierarchy | 20 | One lead/anchor per view; size/weight/position ordering; comparison basis co-visible | Anchor is evident quickly, supporting content is clearly secondary | Multiple equal-weight elements, no visible priority, wrong or missing anchor |
| Grid/spacing | 15 | Aligned edges, consistent gutter/margin rhythm, related items grouped tighter than unrelated | Alignment and spacing rhythm hold across the view, no stray misalignment | Inconsistent alignment, arbitrary/cramped spacing, unrelated items visually grouped |
| Typography | 15 | Role consistency (size/weight per role), line length, tabular numeric alignment, real-string truncation | Roles consistent, numbers aligned/legible, no illegible or clipped essential text | Inconsistent roles, illegible/truncated essential text, misaligned numerics |
| Density/disclosure | 15 | Scan layer concise; required inputs/warnings/comparisons visible without extra clicks; deferred detail retrievable | Essentials visible immediately; disclosure controls open and reveal promised detail | Essentials missing/hidden, or disclosure fails to reveal promised detail |
| Chart integrity | 15 | Bars start at zero; nonzero line/dot axes are explicit and appropriate; units/denominators/missingness visible; marks checked against data | Scale truthful, units/caveats visible, marks confirmed against data | Misleading scale/marks, missing units or caveats; data access missing = unknown; N/A only when no chart is present |
| Medium/responsive | 10 | Target sizes/zoom/print scale actually tested; reading order matches visual order; no clipped overflow | Tested states behave correctly, no scrambled/clipped content | Observed broken reflow, scrambled reading order, or clipped overflow; untested = unknown |
| Identity/restraint | 10 | Consistent accent/role use; no ornament competing with data; medium-appropriate style | Restrained, consistent styling; accents reserved for meaning | Ornamental excess, inconsistent roles, identity conflicting with legibility |

| Dimension | Weight | 0–4, unknown, or justified N/A | Evidence/location |
| --- | ---: | --- | --- |
| Hierarchy | 20 | | |
| Grid/spacing | 15 | | |
| Typography | 15 | | |
| Density/disclosure | 15 | | |
| Chart integrity | 15 | | |
| Medium/responsive | 10 | | |
| Identity/restraint | 10 | | |

- Coverage: applicable dimensions scored …/…; untested mandatory gates:
- Score: `100 × sum(weight × rating/4) / sum(applicable weights)` = …/100 **only if** every applicable dimension has a 0–4 rating or justified N/A. If any applicable dimension is unknown, do not report this unconditional overall score. An optional partial score computed only over the dimensions actually rated may be shown, but it must state its weight coverage (e.g., "62/75, covering rated weights only") and must never be presented as a whole-artifact score or pass.
- Heuristic verdict: >=80, all applicable dimensions >=3, no blocker, mandatory gates tested? yes/no/provisional; reason. Mandatory functional/contrast/semantic/data gates can still block acceptance even when every rated dimension looks good.

## Prioritized revision and comparable verification

1. Blockers, then major, then minor, with exact changes:
2. Re-render **same states/sizes/themes/content** after fixes; list evidence IDs:
3. Re-score and compare dimension-by-dimension; check new regressions:
4. Remaining exceptions, unknown/not tested checks, owner/next action:
