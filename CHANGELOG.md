# Changelog

What was added to or changed in this repository, newest first, by merge date. Each component has its own README; the licence grants are recorded in [LICENSING](LICENSING.md). This repository is updated weekly; a week with nothing to publish has no entry.

## 2026-11-23

- Added [isolated browser launcher](projects/isolated-browser-launcher/README.md): one Node file that starts headless Chromium or Firefox for tests on a free port with a throwaway profile, a deadline on every wait and a guaranteed kill on exit; Firefox is driven over WebDriver BiDi with Chrome's protocol shape.
- Added [agent push guards](projects/agent-push-guards/README.md): a `pre-push` hook and identity check for shared checkouts used by several coding agents (role-address commits only, clean HEAD, no force-push to the main branch, one test suite at a time under a file lock).
- Added [temp-root runner](projects/temp-root-runner/README.md): runs a command with its own short `TMPDIR` and removes it on every way out.
- Added this changelog. The component catalog, the current-tree check and its tests now cover eight components.
- Unchanged this week: Research MCP, Token Flow demo, visual design skill, exact-head merge and shell pitfalls.

## 2026-11-09

- Added [exact-head merge](projects/exact-head-merge/README.md) and [shell pitfalls](projects/shell-pitfalls/README.md) (#6).

## 2026-11-08

- Added the [visual design skill](projects/visual-design-skill/README.md) (#3) and its follow-up notes (#4); a test for the catalog's retained-list guard (#5).

## 2026-10-13

- Current-tree validation and the component catalog; Research MCP maintenance documented (#2).

## 2026-10-12

- Added the offline [Token Flow demo](projects/token-flow-demo/README.md) with synthetic data (#1).

## 2026-10-10

- First release: [Research MCP](projects/research-mcp/README.md), a bounded stdio scholarly-metadata server.
