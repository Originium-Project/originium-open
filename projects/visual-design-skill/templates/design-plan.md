# Design plan template

Copy this before any page/artifact implementation. Decisions must state **choice -> principle ID -> why -> test**. Label all numerical design defaults as authored heuristics. Do not invent missing data or approval.

## Brief

- Objective and leading question/task:
- Audience and environment:
- Medium and artifact/page:
- Content source, data scope, freshness, and unknowns:
- Target sizes, themes, states, locale, and assistive/input modes:
- Project approval gate and owner:

## Six-field pre-build contract

1. **Ranked information hierarchy:** 1) … 2) … 3) …; identify the supported conclusion or current task state and its scope.
2. **Primary visual anchor:** …; why this evidence/action deserves the largest emphasis.
3. **Secondary information:** …; keep essential comparisons and warnings adjacent to the lead.
4. **Hidden/deferred content:** …; exact label, location, retrieval action, and accessible equivalent. Write “none” if none. Never defer required input, consequential warning, or essential claim context.
5. **Grid structure:** named rails/columns/page logic/cell widths and meaningful separators; state where it changes.
6. **Intended reading order at target sizes:** desktop/print/narrow/keyboard/screen-reader/terminal as applicable; name exceptions.

## Decision register

| Choice | Principle ID | Why for this audience/content | How to check in actual render/function |
| --- | --- | --- | --- |
| … | H1/G1/etc. | … | … |

## Acceptance and exceptions

- Views and states to capture at named size, theme, content case, and revision:
- Numeric/source truth checks separate from visual review:
- Keyboard, semantics, contrast, disclosure, export, or terminal checks:
- Explicit exceptions, reason, affected users, and mitigation:
- Missing evidence or blocked checks (do not claim pass):
