# Medium adapters

Use the standalone [skill](../skills/visual-design/SKILL.md) for the six-field contract and review loop. This guide expands implementation choices where medium behavior matters. Every choice still needs a content-specific reason and an actual render/function check.

## PDF and print report

| Decision -> why | Check |
| --- | --- |
| Decide audience, page size, orientation, binding/print context first -> physical reading distance and fixed pages govern measure. A4/Letter margins about 16–22 mm, body 10.5–12 pt, leading 1.3–1.5 are **authored starters**, not accessibility guarantees; offer larger type as needed. | Print at intended size; inspect legibility and trim. Do not paste web pixel or viewport units into page design. |
| Build conclusion/summary -> evidence pages -> numbered notes/appendices, while keeping each claim's essential caveat and comparison on the same page/spread -> paper cannot reveal hidden context. | Inspect every claim and its denominator/source; no hover, collapsed-only text, or required online interaction. |
| Repeat page numbers, section headers, and table headers; use a baseline/column logic and deliberate page breaks -> a detached sheet must still be navigable. | Render **all pages** as a contact sheet; inspect representative pages, page transitions, orphan/widow lines, stranded headings, captions, and split tables. |
| Restructure a wide figure or use a labeled landscape page instead of microscopic reduction -> fixed-width charts become unreadable quickly. | Inspect charts at actual reading size; table/figure and caption stay together. |
| Export vector graphics where possible, licensed embedded fonts, selectable text, tagged headings/tables, useful links/bookmarks, and alt descriptions -> visible similarity does not ensure usable structure. | Test exported PDF text selection, links, tags, logical reading/tab order (especially complex columns), and grayscale/print flattening. No automatic PDF/UA claim. |

## Website

| Decision -> why | Check |
| --- | --- |
| Start with the user's task/context; lead with a supported answer or safe next action rather than a mandatory marketing hero -> a functional page needs orientation and progress. | First view and keyboard reading order match the plan. |
| Use semantic headings, lists, tables, labels, and primary action hierarchy -> visual order alone cannot serve assistive technology. | Keyboard/focus and screen-reader semantics separately from screenshot review. |
| Let content reflow; break when labels/charts collide, not at a fashionable device preset -> content and zoom vary. | 320/390/768/1024/1440 CSS px, short viewport, 200% text, and 400% zoom/320CSS reflow as applicable. |
| Keep chart values, status, errors, and required operations available at every width; bounded table/diagram pan may be local -> a responsive screenshot must still complete the task. | Test long strings, loading/empty/error, touch, keyboard, local pan, and numeric alternative. |

## Dashboard

| Decision -> why | Check |
| --- | --- |
| State the leading question and scoped, supported answer; give its evidence a dominant region -> monitoring needs fast orientation without inventing trends. | Claim agrees with current data, denominator, period, and coverage. |
| Keep related comparisons co-visible, then offer labeled exact detail -> forcing memory across pages or deleting data both damage decisions. | Verify table/drilldown, filters, and disclosure actually work; preserve warnings. |
| Group related metrics, reserve accent for exceptions/actions, and size charts for relationships instead of equal thumbnail cards -> hierarchy carries density. | Inspect short/long time series, missing data, narrow view, and exact numeric lookup. |
| Treat current state, historical aggregates, estimates, and partial coverage as distinct -> visually similar numbers can have incompatible meanings. | Verify units, source freshness, and no unknown-as-zero placeholders. |

## GUI application / admin console

| Decision -> why | Check |
| --- | --- |
| Lead with current state, action, and consequence; put destructive/irreversible changes behind clear confirmation -> users need a safe path from viewing to committing. | Inspect idle, editing, validation, pending, success, error, and confirmation states. |
| Follow platform navigation, focus, keyboard, modal, and target-size guidance -> native expectations and accessibility differ from web. | Test native focus return, escape/cancel, screen reader, and dynamic text/platform scaling. |
| Preserve essential warnings and operations in compact layouts; defer only advanced options with explicit labels -> hidden controls can turn a task unsafe. | Verify the required operation and recovery path at small windows and large text. |

## CLI and full-screen TUI

| Decision -> why | Check |
| --- | --- |
| Use result -> relevant evidence -> `--verbose`, `--help`, or inspect command for depth -> humans need a quick answer and scripts need stable data access. | Compare default/help/verbose and machine-readable output; full values available. |
| Use ordering, headings, whitespace, indentation, labels, and optional emphasis rather than CSS pixels, font sizes, or brand color -> terminal theme and cell geometry are user-controlled. | Test NO_COLOR, light/dark themes, monochrome, plain non-TTY output without cursor sequences. |
| Adapt wide tables to key/value rows or lists at narrow widths; account for Unicode display width and ASCII fallback -> character count is not cell width. | Test 80x24, 120x40, and a narrower width; no silent column clipping. |
| Keep stdout for data and stderr for diagnostics; make terse errors actionable -> streams are part of CLI composition. | Pipe/redirect each stream and inspect exit status. |
| In a TUI, define current pane, focus order, keyboard help/escape, and resize behavior -> a full-screen interface cannot rely on scrolling a plain transcript. | Test keyboard-only navigation, resize, and focus after dialogs. These TUI rules are authored adaptations; the cited CLI guide does not cover full-screen TUIs. |
