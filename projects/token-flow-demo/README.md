# Token Flow demo

An offline dashboard with deterministic invented usage: 133 tasks across 30 fixed UTC days ending 29 September 2026. Charts, compact tables and totals share one synthetic dataset. This is an interface demo, not a telemetry collector or billing integration.

Open [index.html](index.html) directly in a JavaScript-enabled browser, keeping the directory intact. Classic local scripts support file opening; no server, install, account or network connection is needed.

With Node.js 18+ and npm, from this directory:

```sh
npm test
npm run check
```

There are no package dependencies. Tests cover calculations, inclusive date ranges, local assets, preference failures, empty/error states and control wiring through a DOM double. `check` checks JavaScript syntax. These checks do not establish browser rendering, screen-reader behavior or accessibility conformance; no browser validation is claimed for this import.

Use the labeled 7/14/30-day selector, light-mode and compact-spacing buttons, section links and native disclosures. The UI includes a skip link, visible focus styling, pressed states, status announcements, labeled meters and a daily data-table alternative to the chart. Without JavaScript, guidance and the fixed capacity/design sections remain; usage controls stay disabled. Capacity is an invented snapshot independent of the date selector.

All task titles, dates, token counts, costs, capacity limits and reset times are invented. Provider names are illustrative labels. Rates in [data.js](data.js) are invented USD per million tokens, not current prices or quotes. Costs sum integer microdollars before display rounding; cache rate is cached input divided by total input.

No real telemetry, prompts, account identifiers, credentials or private paths are included. The runtime has no external asset loads or service contacts. Browser storage under `token-flow-study` holds only theme, density and selected period; denied or corrupt storage falls back to defaults. Clear that browser storage entry to reset preferences. The demo does not ingest files, connect accounts or update its fixed dataset.

Project-owned code and documentation, including the authored structural defaults under `vendor/`, are [MIT licensed](LICENSE), copyright (c) 2026 Originium Project contributors. See [SOURCE.md](SOURCE.md) for source hashes and the [component inventory](component-manifest.json) for retained-byte hashes. The legacy root release approvals and exact-inventory launcher cover only Research MCP and reject the expanded repository. This component requires its own parent review and secret scan before publication; its inventory records no completed publication approval.
