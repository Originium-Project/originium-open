# Four synthetic medium briefs

These are original invented scenarios illustrating the six-field contract. None was rendered, tested, or validated. Values and topics are placeholders, not product facts. Each choice carries a reason and intended check.

## PDF: neighborhood tree survey

**Objective/audience/source:** Municipal staff reviewing a synthetic survey. Print A4 portrait, grayscale, with a wider map page if needed. Source would be a documented survey table; counts and coverage are unknown.

1. **Rank:** Executive finding with coverage -> species/condition evidence -> methodology/records.
2. **Anchor:** One legible condition comparison chart with denominators, because the decision is comparative (H1/V3); inspect at print size.
3. **Secondary:** Location and sample caveats beside chart, because separated caveats mislead (H3); proof page context.
4. **Deferred:** Numbered appendix of records and method, cross-referenced in body; no caveat required to interpret the claim is deferred (D1); follow page references.
5. **Grid:** Two-column text/evidence page, consistent margins/baseline, landscape figure only if the map cannot remain readable (G2); inspect page breaks.
6. **Reading order:** Summary -> chart/caption -> notes -> appendix, matching tagged PDF order (A1); validate actual export tags and selectable text.

## Website: public library event page

**Objective/audience/source:** Visitors deciding whether and how to attend an invented event. Responsive web; event metadata would come from a maintained calendar and must be checked.

1. **Rank:** Event identity/time/place/access status -> registration action -> description/travel detail.
2. **Anchor:** Title/date/place plus the primary registration action, because the task is attendance, not chart reading (H1); inspect first view.
3. **Secondary:** Accessibility and capacity notes beside registration, because they affect the decision (D1); test long notes.
4. **Deferred:** Full travel directions under a labeled section; required location remains visible (D2); keyboard-open and screen-reader check.
5. **Grid:** Wide main content/support rail, stacking to one semantic column when text collides (R1); test 320/390 and 400% zoom.
6. **Reading order:** Identity -> essentials -> register -> description -> directions at all widths (R1); inspect DOM/focus order.

## GUI app: photo export dialog

**Objective/audience/source:** A creator choosing output settings for a local file. Native desktop app; state comes from selected files and actual export support.

1. **Rank:** Destination/current selection -> format/quality controls -> estimated consequence -> export/cancel.
2. **Anchor:** Destination and safe primary action, because committing to a wrong path is costly (H1/A1); inspect confirmation state.
3. **Secondary:** Existing-file warning and estimated size near action, because warnings need decision context (D1); test overwrite case.
4. **Deferred:** Advanced metadata/color options behind “Advanced”; chosen values still summarized before export (D2); open with keyboard.
5. **Grid:** Aligned label/control rails with vertical growth under native text scaling (G1/R3); inspect small window.
6. **Reading order:** Destination -> options -> warning/summary -> actions, including focus return after errors (R1); test keyboard and screen reader.

## CLI/TUI: backup status command

**Objective/audience/source:** Operator checking a synthetic local backup job; runtime status would come from the tool's real state, never invented.

1. **Rank:** Result/state -> last completed run and destination -> next inspection command.
2. **Anchor:** A plain-text status line with timestamp and scope, because an operator needs a quick trustworthy result (H1/D3); inspect stale/error output.
3. **Secondary:** Counts, duration, and warning summary as labeled rows, because terminal color/size are unreliable (T3/A1); test NO_COLOR.
4. **Deferred:** `backup status --verbose` for file detail and `--json` for machines; warnings and exit status stay immediate (D1); pipe outputs.
5. **Grid:** Character-cell key/value layout at narrow widths, bounded columns at 80/120 cells (G1/R3); test Unicode/ASCII width.
6. **Reading order:** Result -> evidence -> suggested command in plain CLI; if a TUI exists, current pane/focus/help/escape are explicit (A1); test resize and keyboard.
