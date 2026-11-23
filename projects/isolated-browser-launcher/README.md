# Isolated browser launcher

One Node file (`browser-launch.mjs`, Node 22+ for the global `WebSocket`, built-in modules only, no install step) that starts a headless Chromium or Firefox for tests and tools so that several sessions on one machine cannot drive each other's browsers.

Why it exists: browsers started on a fixed or guessed `--remote-debugging-port` ran into a port already taken by another session's browser, or listening on IPv6 only, and the test waited for ever or drove the wrong page. The launcher removes that class of failure:

- **Free port from the browser itself.** It passes port 0 and a private temporary profile; the port is read from the browser's own `DevToolsActivePort` file (Firefox: from the "WebDriver BiDi listening" line). Only `127.0.0.1:<that port>` is ever connected to.
- **A deadline on every wait.** Start, socket open, each DevTools command, each awaited event. The error says what was awaited; a start failure names the binary and the end of its stderr. A browser that dies fails the commands still waiting at once.
- **A guaranteed kill.** `close()` kills the browser and its children (its own process group) and removes the profile. A browser still open when the process exits (`process.exit`, a thrown error, SIGINT, SIGTERM, SIGHUP, or even SIGKILL through a small detached watchdog) is killed the same way.
- **Firefox through BiDi, shaped like Chrome's protocol.** With `BROWSER=firefox` (or `browser: 'firefox'`) the page object has the same `send`, `on`, `waitEvent`, `evaluate`, `close` shape, so test code written for Chromium runs unchanged. The supported Chrome DevTools Protocol methods are listed in `FIREFOX_CDP_METHODS`; any other method rejects with "not available in Firefox".

## Use

```js
import { openPage, withDeadline } from './browser-launch.mjs';

const page = await openPage({ args: ['--window-size=1280,900', 'about:blank'] });
try {
  await page.send('Page.enable');
  await page.send('Page.navigate', { url: 'http://127.0.0.1:8080/' });
  console.log(await page.evaluate('document.title'));
} finally {
  await page.close();   // kills the browser, removes the profile
}
```

| Export | What |
|---|---|
| `launchBrowser(opts)` | Start a browser: `{ pid, port, profile, stderrTail(), openPage(), newPage(), connect(target), close() }`. `opts`: `bin`, `args`, `timeoutMs`, `cdpTimeoutMs`, `browser` (`'chromium'` or `'firefox'`), `preloadScript` (JavaScript run first in every document). The caller must not pass its own debugging port or profile. |
| `openPage(opts)` | `launchBrowser` plus a connection to the first page; its `close()` closes both. |
| `withDeadline(promise, ms, what)` | Reject with "timed out after N ms waiting for <what>". |
| `findChromiumShell()`, `findFirefox()`, `findChrome()` | Locate a browser: the Playwright headless shell under `~/.cache/ms-playwright` (what `launchBrowser` starts when no `bin` is given); `$FIREFOX_BIN`, else `firefox-esr` or `firefox` on `PATH`; `findChrome()` returns `$CHROME` or the shell, for callers that pass it as `bin`. |
| `connectCdp`, `connectBidi`, `createBidiPage` | Lower-level connections. |

Environment: `BROWSER=firefox` selects Firefox; anything else is Chromium. `FIREFOX_BIN` names the Firefox binary; `CHROME` is read by `findChrome()` only.

## Tests

```sh
node --test tests/launch.test.mjs tests/firefox.test.mjs
```

The launch tests use stand-in "browsers" (small Node scripts), so they need no browser. The Firefox translation tests use a fake transport; the tests marked "a real Firefox" run only where Firefox is installed and are skipped otherwise. Developed and tested on Linux. The launcher has a fallback where `/proc` does not exist; it is not tested here.

## License

MIT, copyright (c) 2026 Originium Project contributors; see [LICENSE](LICENSE). No third-party code is bundled; Chromium, Firefox and Playwright are not distributed with it.
