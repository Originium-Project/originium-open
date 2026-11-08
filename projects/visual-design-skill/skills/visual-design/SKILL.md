---
name: visual-design
description: Plan, build, and critique visual design for PDF reports, websites and dashboards, GUI apps, and CLI/TUI interfaces. Produces an information plan, medium-aware decisions with reasons, and evidence-based render review; requires no framework or external files.
---

# Visual design

Use for new work, redesign, or review. These instructions do not render or grant release approval. Numerical defaults and score cutoffs are **authored heuristics**, not book rules or accessibility standards. Preserve data and approval gates.

## Operating workflow

**Before implementation**, output six fields: (1) ranked information hierarchy; (2) primary visual anchor; (3) secondary information; (4) hidden/deferred content and exact retrieval path; (5) grid structure; (6) intended reading order at target sizes. State audience, task, medium, data source, sizes/states. Each choice needs **decision -> principle ID -> why -> test**. Say “none” if nothing is deferred. Keep essential inputs, comparisons, warnings, and uncertainty visible. Check actual content/schema; honor approval gates.

Then build. **After implementation**, capture and open the render at named size, theme, state, and revision. Record located violations **before edits**; score, then fix blockers and major issues first. Re-render comparable views, rescore, and check regressions. Without capture, mark visual review blocked/provisional. Screenshots cannot verify keyboard/assistive-technology semantics, exact math, measured contrast, or disclosure behavior; test separately.

**Medium mapping (rule -> why -> check).** PDF: choose page size/orientation; use page units (A4/Letter margin 16–22mm, body 10.5–12pt, leading 1.3–1.5 are authored starts), not web pixels -> fixed print scale; proof at actual size. Summary -> evidence -> numbered notes; keep caveats with claims, repeat page/table headers, protect figures/captions and breaks -> no hover/disclosure on paper; render all pages and inspect risky boundaries. Export selectable text/vector, tagged headings/tables, alt text, logical reading/tab order, and licensed embedded fonts -> pixels cannot prove structure; inspect export, print/grayscale, links/bookmarks, font licensing; make no automatic PDF/UA claim. Web: semantic order/reflow -> variable width/input -> test zoom, keyboard, states. GUI: action/state/error, native focus/modal/text scaling -> safe completion -> test those states. CLI/TUI: order/labels/indentation/cell width, not pixel size or brand color -> user controls terminal; test 80x24, 120x40, narrow, NO_COLOR, ASCII fallback. Keep stdout data/stderr diagnostics, plain non-TTY output without cursor codes and full values via `--verbose`/machine output. TUI needs pane/focus/help/escape/resize tests.

## 1 Core design principles

- **H1, answer and evidence:** Lead each section with one question, supported conclusion, or task state and one dominant evidence anchor -> a reader can locate purpose before decoding detail. A data conclusion must name scope and be supported; when evidence is insufficient, state that. In a form, “conclusion” means purpose, current state, and next safe action, not an editorial claim. Check that the lead and evidence agree.
- **D1, layered density:** **High information density does NOT mean displaying everything simultaneously.** Structure conclusion -> evidence -> details on demand -> attention is finite, while inspection still needs depth. Keep required inputs, consequential warnings, essential comparisons, and uncertainty immediately accessible; verify the retrieval path for deferred detail.
- **G1, relational structure:** Group by meaning and align related edges -> proximity and repetition reveal relationships without extra decoration. Check that comparable items are co-visible and unrelated items have a stronger break.
- **A1, truth and access:** Preserve labels, provenance, meaning, and access in every medium -> elegance cannot compensate for a wrong or inaccessible answer. Check content, math, disclosure, accessibility, and privacy independently of screenshots.

## 2 Visual hierarchy

- **H2:** Give the anchor room to show relationships, then make context quieter but readable -> equal emphasis obscures priority. Use size, weight, position, and space before extra color. Check a thumbnail/squint scan as a heuristic, not a timed measure. One anchor per section need not mean one chart for the artifact.
- **H3:** Keep conclusion, comparison basis, and caveat near evidence -> separated context misleads. Offer exact detail via a clear path; check the claim in place.
- **H4:** Reserve strong accents for action, state, or evidence emphasis and use consistent roles -> novelty loses meaning when every card is highlighted. Check the same role across states and pages.

## 3 Grid and spacing

- **G2:** Name common edges/rails and give related regions useful spans; an asymmetric 8:4 split is an authored start when content fits -> alignment supports scanning, while equal boxes waste space. Check content at target widths. Layout grid, decorative grid, and chart guides differ; show lines only when they clarify a boundary or reading.
- **G3:** Start with a 4/8/12/16/24/32/48/64 CSS-pixel-equivalent web spacing scale, adapting to medium -> repeated intervals make hierarchy predictable. Space within groups stays smaller than between groups; use section breaks without empty forced-height panels. Four/eight/twelve column rails are authored starts, not prescribed book values. Check render rhythm.
- **G4:** Let content set height except bounded charts/local scroll -> forced viewport panels strand content. Separate meaningful boundaries; check short/tall views.

## 4 Typography

- **T1:** Define a small role set: web metadata 13–14px, body 16px, section 20–24px, page/anchor 28–36px as rem equivalents; body leading 1.45–1.6 and tighter short headings -> predictable roles aid scanning. These are authored starters, not accessibility guarantees; increase as content, users, or platform require. Check at real size and text zoom.
- **T2:** Keep Latin-script prose 45–75ch as an authored start -> long lines are hard to resume. Adapt for scripts; check strings and truncation.
- **T3:** Use tabular figures and right/decimal alignment in numeric columns; keep units and precision consistent -> comparisons otherwise depend on mental cleanup. Avoid long all-caps prose, unnecessary monospace in web/PDF prose, or ellipsis without an accessible full value; terminal text may use monospace. Check largest/negative/missing values.
- **T4:** On web, measure actual composited text contrast: WCAG normal text 4.5:1, large text 3:1 (at least 24 CSS px regular or 18.67px bold). Meaningful UI boundaries/graphical information have a 3:1 non-text criterion where applicable; decorative lines need not carry state -> faint styling must not erase meaning. Visible keyboard focus and semantic headings/tables matter separately. A 44 CSS px main touch target is an authored ergonomic target, **not** a WCAG AA mandate; native platform guidance takes precedence. Check measured layers, focus, and controls.

## 5 Dashboard information density

- **D2:** Show a concise scan layer, substantial evidence, and a labeled route to exact records -> viewers need both orientation and auditability. Compact rows/insets before shrinking type or targets. Check that search, table, expansion, or drilldown actually reveals promised detail.
- **D3:** Show scope, period/time zone, current versus historical status, comparison basis, and missing/stale/partial coverage -> unscoped numbers mislead. Unknown is not zero; check loading/empty/error states.
- **D4:** Keep comparisons together, even in a table -> memory is poor for comparison. Defer uncommon detail, never required input, warning, or claim basis; check retrieval.

## 6 Data visualization

- **V1, choose by question:** Time -> line/columns; ranked quantities -> horizontal bars; exact lookup -> table; distribution -> histogram/box; association -> scatter without causality claim; flows -> Sankey only when links conserve a meaningful quantity -> form encodes the question. Check question and data before chart choice.
- **V2, truthful scale:** Start bars at zero; axis breaks are not routine exemptions. For small differences use dots or labeled nonzero line axes; use common comparison scales -> lengths otherwise misstate magnitude. Avoid misleading area, 3D, dual axes; check marks against values.
- **V3, context and uncertainty:** Show units, period, denominators, missingness/uncertainty, and a numeric alternative -> decoration removal must not remove interpretation. Avoid arbitrary zero placeholders and chart-family variety for ornament. Keep useful chart guides/axes subtle rather than deleting them. Check the equivalent table/values.
- **V4, multiple encodings:** Color must not be the sole signal; use direct labels, line styles, shapes, or small multiples where grayscale series would merge -> readers may print, use different themes, or perceive color differently. Check monochrome and actual contrast.

## 7 Responsive layout

- **R1:** Break where content needs it; stack main/support regions with DOM/reading order aligned to visual order -> rearrangement must preserve comprehension and focus. Avoid global font shrinking, hidden required operations, and overflow masking. Check states at authored probe widths 320/390/768/1024/1440 CSS px and a short viewport.
- **R2:** Retain function at 200% text and 400% browser zoom/320 CSS-pixel-equivalent reflow -> zoom users need the same task. A two-dimensional table/diagram may scroll **locally** with visible context and table alternative; surroundings still reflow. Check focus/overlays. Test native app text scaling separately.
- **R3:** Allow vertical growth and local diagram pan rather than shrinking information past legibility -> fitting a screenshot is not completing a task. Check keyboard/gesture access and exact-value route after stacking.

## 8 Anti-patterns

Treat each as **symptom -> harm -> correction**, then verify on the artifact:

- Equal cards/chart thumbnails -> weak priority -> group by question, enlarge evidence (H1/H2).
- Gratuitous chrome, boxes, grids, glass, gradients, pills, shadows, or random roles competing with content -> decoration obscures meaning -> simplify rails/roles (G1/G3).
- Tiny/truncated labels, rainbow variety, false precision -> trust fails -> readable type/units/marks and exact detail (T1/T3/V1).
- Forced viewport/scroll snap, hidden data, unknown=0, hover-only icons -> tasks disappear -> natural height, labeled paths, truthful states (D1/D3/R3).
- PDF screenshot export -> lost text/structure -> export text/vector and validate tags (A1).
- Wide terminal tables/color-only meaning -> narrow/plain output fails -> adaptive labeled text (A1/R1).

## 9 Page-review checklist

Mark each **yes / no / not tested**, with artifact and evidence. A “no” becomes a located violation; “not tested” cannot become a pass.

1. Six-field contract, rationale/test, source and approval gates complete?
2. Lead supported/scoped, anchor legible, comparisons co-visible, deferred detail working?
3. Grid/type/units consistent; true-size text and long values readable?
4. Actual-layer contrast measured, focus/semantics/keyboard/AT checked, targets usable?
5. Chart scales, units, denominators, missingness, numeric alternative truthful?
6. Reflow/print/native scaling and empty/error/loading/large/disclosure states tested?
7. Actual render opened; provenance/privacy/export metadata checked?

## 10 Screenshot critique rubric

Score **0–4**: 0 missing/unusable; 1 serious faults; 2 mixed; 3 coherent with small issues; 4 exemplary. Authored weights total 100: hierarchy 20, grid/spacing 15, typography 15, density/disclosure 15, chart integrity 15, medium/responsive 10, identity/restraint 10. Score `100 × sum(weight × rating/4) / sum(applicable weights)`. No chart: justified **N/A**, remove weight from numerator/denominator. Untested is **unknown**, not N/A. Report coverage; an unknown applicable dimension blocks any unconditional overall score, and a partial score over only rated dimensions must state its weight coverage, not stand for the whole artifact. Untested mandatory gates prevent unconditional pass.

Heuristic acceptance: at least 80/100, every applicable dimension at least 3, and no blocker. This is a review policy, not validated science. **Blockers override total:** misleading data, unreadable/clipped essentials, unavailable required action/detail, or verified accessibility failure. Major issues materially slow or confuse; minor issues are local polish. For every observed violation record exact view/region/state, principle, user effect, correction, confidence, and recheck. Do not invent findings. A screenshot-only verdict is provisional until functional, semantic, numeric, and contrast checks are done. Capture -> document violations -> prioritize -> fix -> comparable re-render -> rescore/regression check.
