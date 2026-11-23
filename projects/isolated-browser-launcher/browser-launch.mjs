// Starts Chromium or Firefox for tests and tools, with a throwaway profile and a deadline on every wait.
// Several sessions on one machine started browsers on a fixed or guessed --remote-debugging-port: the port was taken by
// another session's browser, was listened on IPv6 only or not at all, and the test then waited for ever (0 % CPU for
// hours) or drove the other session's page. So:
// - port 0 and a private temporary profile: the browser picks a free port and writes it to DevToolsActivePort in that
//   profile, the only place the port is read from; only 127.0.0.1:<that port> is ever connected to;
// - a deadline on the start (30 s by default): the error names the binary and the end of its stderr;
// - close() kills the browser and its children (its own process group) and removes the profile, and a browser still
//   open when the process exits (process.exit, a thrown error, SIGINT/SIGTERM/SIGHUP, or even SIGKILL via a detached
//   cleanup watchdog) is killed (whole process group) and its profile removed too;
// - every DevTools wait has a deadline (the socket opening, each command's answer, an awaited event), and its error
//   says what it waited for. A browser that dies fails the commands still waiting at once.
// tests/launch.test.mjs proves the failure paths with a stand-in browser.
//
// BROWSER=firefox: the same tests drive Firefox instead (launchFirefox below). Firefox speaks WebDriver BiDi, not the
// Chrome DevTools Protocol; createBidiPage hands the tests a page with the same shape as connectCdp's (send, on,
// waitEvent, evaluate, close) and translates the CDP calls the tests make into BiDi commands, and BiDi's events back into
// CDP's (the table is FIREFOX_CDP_METHODS; tests/firefox.test.mjs checks it without a browser). A CDP method with
// no translation rejects, naming the method and "not available in Firefox". With BROWSER unset (or anything but
// "firefox") nothing here changes: the same Chromium binary, the same arguments, the same DevTools messages.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { accessSync, constants as fsConstants, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/** How long a browser may take to write its DevToolsActivePort, and a page target or socket to appear (ms). */
export const LAUNCH_TIMEOUT_MS = 30_000;
/** How long one DevTools command may take to answer (ms); a command can pass its own. */
export const CDP_TIMEOUT_MS = 60_000;

/**
 * The browser the browser tests drive: 'firefox' when the environment says BROWSER=firefox, else 'chromium' (BROWSER
 * unset, empty, or any other value: the Chromium path, unchanged).
 */
export function browserFromEnv(value = process.env.BROWSER) {
  return String(value ?? '').trim().toLowerCase() === 'firefox' ? 'firefox' : 'chromium';
}
/** 'chromium' or 'firefox', read once from BROWSER when this module loads (browserFromEnv). */
export const BROWSER_NAME = browserFromEnv();

/** The Playwright headless shell under ~/.cache/ms-playwright; throws where none is installed. */
export function findChromiumShell() {
  const root = join(homedir(), '.cache/ms-playwright');
  if (!existsSync(root)) throw new Error('chromium_headless_shell not found under ~/.cache/ms-playwright');
  const shell = readdirSync(root).filter(d => d.startsWith('chromium_headless_shell')).sort().pop();
  if (!shell) throw new Error('chromium_headless_shell not found under ~/.cache/ms-playwright');
  const sub = readdirSync(join(root, shell)).find(d => d.startsWith('chrome-'));
  if (!sub) throw new Error('chrome-* not found under chromium_headless_shell');
  const bin = join(root, shell, sub, 'chrome-headless-shell');
  if (!existsSync(bin)) throw new Error(`${bin} not found`);
  return bin;
}

/**
 * Firefox for BROWSER=firefox: $FIREFOX_BIN when set, else `firefox-esr`, else `firefox` on PATH; throws where none is
 * found. Only looked up in Firefox mode: with BROWSER unset no Firefox is ever searched for or started.
 */
export function findFirefox() {
  const own = process.env.FIREFOX_BIN;
  if (own) {
    if (!existsSync(own)) throw new Error(`FIREFOX_BIN=${own} not found`);
    return own;
  }
  for (const name of ['firefox-esr', 'firefox']) {
    for (const dir of String(process.env.PATH || '').split(delimiter)) {
      if (!dir) continue;
      const bin = join(dir, name);
      try { accessSync(bin, fsConstants.X_OK); if (statSync(bin).isFile()) return bin; } catch { /* not here */ }
    }
  }
  throw new Error('no Firefox (set FIREFOX_BIN, or put firefox-esr or firefox on PATH)');
}

/**
 * The headless binary of the browser the tests drive: the Playwright headless shell (findChromiumShell), or with
 * BROWSER=firefox the Firefox of findFirefox, so the tests that pass `bin: findHeadlessBinary()` and skip on !HAS_BROWSER
 * run in Firefox on a machine without Chromium. Throws where that browser is not installed.
 */
export function findHeadlessBinary() {
  return BROWSER_NAME === 'firefox' ? findFirefox() : findChromiumShell();
}

/** $CHROME when set, else the Playwright headless shell. */
export function findChrome() {
  // In Firefox mode launchBrowser starts findFirefox() whatever `bin` it is given.
  if (BROWSER_NAME === 'firefox') return findFirefox();
  if (process.env.CHROME) return process.env.CHROME;
  try { return findHeadlessBinary(); } catch { throw new Error('no headless Chromium (set CHROME or install the Playwright headless shell)'); }
}

/** True where the Playwright headless shell is installed (browser tests skip elsewhere); with BROWSER=firefox, Firefox. */
export const HAS_BROWSER = (() => { try { return Boolean(findHeadlessBinary()); } catch { return false; } })();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitOrWake = (ms, wake) => new Promise(resolve => {
  let done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(t); resolve(); };
  const t = setTimeout(finish, ms);
  wake.then(finish);
});

/**
 * `promise`, or a rejection "timed out after <ms> ms waiting for <what>" once `ms` have passed. `onTimeout` runs first
 * (to drop what was waiting).
 */
export function withDeadline(promise, ms, what, onTimeout) {
  let timer;
  const late = new Promise((_, fail) => {
    timer = setTimeout(() => { try { onTimeout?.(); } catch { /* best effort */ } fail(Object.assign(new Error(`timed out after ${ms} ms waiting for ${what}`), { code: 'DEADLINE' })); }, ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// Browsers still open: killed, and their profiles removed, when the process exits or is stopped by a signal.
const live = new Set();
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
function reapAll() { for (const b of [...live]) b.reap(); }
function onSignal(sig) {
  // Then the default action (end the process), unless someone else handles the signal.
  const alone = process.listenerCount(sig) === 1;
  reapAll();
  release();
  if (alone) process.kill(process.pid, sig);
}
function hold(b) {
  if (!live.size) { process.on('exit', reapAll); for (const s of SIGNALS) process.on(s, onSignal); }
  live.add(b);
}
function release(b) {
  if (b) live.delete(b); else live.clear();
  if (!live.size) { process.removeListener('exit', reapAll); for (const s of SIGNALS) process.removeListener(s, onSignal); }
}

// Detached per-browser watchdog: blocks on stdin until the test process closes its write end (including on SIGKILL),
// then kills the browser's whole process group and removes its temporary profile; disarmed with "done\n" on close().
const WATCHDOG_SH = [
  'IFS= read -r line || true',
  '[ "$line" = done ] && exit 0',
  'pgid="$1"; prof="$2"; pfx="$3"',
  'case "$pgid" in ""|*[!0-9]*|0|1) ;; *)',
  '  kill -KILL -"$pgid" 2>/dev/null || true',
  '  i=0',
  '  while [ "$i" -lt 80 ] && kill -0 -"$pgid" 2>/dev/null; do',
  '    kill -KILL -"$pgid" 2>/dev/null || true',
  '    sleep 0.05 2>/dev/null || sleep 1',
  '    i=$((i + 1))',
  '  done',
  ';; esac',
  'case "$prof" in ""|/|*..*) ;; "$pfx"*)',
  '  rm -rf -- "$prof" 2>/dev/null || true',
  '  if [ -e "$prof" ]; then sleep 0.1 2>/dev/null || true; rm -rf -- "$prof" 2>/dev/null || true; fi',
  ';; esac',
].join('\n');

function startCleanupWatchdog(pgid, profile) {
  if (!pgid || pgid <= 1) return { disarm() {}, trigger() {} };
  const wd = spawn('/bin/sh', ['-c', WATCHDOG_SH, 'ibl-browser-watchdog', String(pgid), profile, join(tmpdir(), 'ibl-')], {
    detached: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  wd.on('error', () => {});
  wd.stdin.on('error', () => {});
  wd.unref();
  wd.stdin.unref();
  let settled = false;
  return {
    wd,
    disarm() {
      if (settled) return;
      settled = true;
      try { wd.stdin.end('done\n'); } catch { try { wd.kill('SIGKILL'); } catch { /* gone */ } }
    },
    trigger() {
      if (settled) return;
      settled = true;
      try { wd.stdin.end(); } catch { /* closed */ }
    },
  };
}

function groupHasLiveProcess(pgid) {
  if (!pgid || pgid <= 1) return false;
  try { process.kill(-pgid, 0); } catch { return false; }
  try {
    for (const d of readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const s = readFileSync(`/proc/${d}/stat`, 'utf8');
        const i = s.lastIndexOf(') ');
        if (i < 0) continue;
        const f = s.slice(i + 2).split(' ');
        if (Number(f[2]) === pgid && f[0] !== 'Z') return true;
      } catch { /* exited */ }
    }
    return false;
  } catch {
    // Non-/proc platforms (e.g. macOS) rely on process.kill(-pgid, 0) above once gone has reaped the group leader.
    return true;
  }
}

async function waitForGroupGone(pgid, budgetMs = 2000) {
  if (!pgid || pgid <= 1) return;
  for (const end = Date.now() + budgetMs; Date.now() < end && groupHasLiveProcess(pgid);) {
    try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
    await sleep(25);
  }
}

/**
 * Starts `bin` with `args` on --remote-debugging-port=0 and a private --user-data-dir (both added here; `args` must not
 * carry either), and resolves once the browser wrote its port, with
 * `{ bin, pid, port, profile, stderrTail(), pageTarget(), newPage(), connect(target), openPage(), close() }`.
 * Rejects (killing the browser, removing the profile) when the browser exits first or `timeoutMs` passes; the message
 * starts "could not start headless Chromium" and names `bin` and the end of its stderr.
 * With BROWSER=firefox (or `browser: 'firefox'`) it starts Firefox instead (launchFirefox: `bin` is ignored, the args
 * are translated by firefoxArgs) and resolves with the same shape, whose pages speak CDP through createBidiPage.
 * `preloadScript` (a string of JavaScript, default none) runs first in every document a launched browser opens, before
 * any page script: Chromium through Page.addScriptToEvaluateOnNewDocument, Firefox through a BiDi preload script.
 */
export async function launchBrowser(opts = {}) {
  // `browser` ('chromium' | 'firefox') overrides BROWSER for one launch (the stand-in tests pin 'chromium').
  if ((opts.browser ?? BROWSER_NAME) === 'firefox') return launchFirefox(opts);
  return launchChromium(opts);
}

async function launchChromium({ bin = findChromiumShell(), args = [], timeoutMs = LAUNCH_TIMEOUT_MS, cdpTimeoutMs = CDP_TIMEOUT_MS, preloadScript = null } = {}) {
  if (args.some(a => /^--(?:remote-debugging-port|user-data-dir)=/.test(a))) throw new Error('launchBrowser adds --remote-debugging-port=0 and --user-data-dir itself');
  const profile = mkdtempSync(join(tmpdir(), 'ibl-cdp-'));
  let stderr = '';
  let exited = null;
  // Its own process group, so close() kills the browser's children with it.
  const child = spawn(bin, [`--user-data-dir=${profile}`, '--remote-debugging-port=0', ...args], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  const watchdog = startCleanupWatchdog(child.pid, profile);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
  const sockets = new Set();
  const cdps = new Set();
  const unrefStreams = () => {
    try { child.stderr?._handle?.unref?.(); } catch { /* closed */ }
    try { child.unref(); } catch { /* gone */ }
  };
  const destroyStreams = () => {
    try { child.stderr?.destroy(); } catch { /* closed */ }
    try { child.unref(); } catch { /* gone */ }
  };
  const onChildGone = why => {
    if (exited) return;
    exited = why;
    for (const c of [...cdps]) { try { c.close(); } catch { /* closed */ } }
    for (const ws of [...sockets]) { try { ws.close(); } catch { /* closed */ } }
    unrefStreams();
  };
  const gone = new Promise(r => {
    child.once('error', err => { onChildGone(`could not be run (${err.code || err.message})`); r(); });
    child.once('exit', (code, signal) => { onChildGone(`exited (${signal ? `signal ${signal}` : `code ${code}`})`); r(); });
  });
  let closing = null;
  const stderrTail = () => stderr.trim().split('\n').slice(-5).join('\n').slice(-600);
  // The whole group: the browser's renderers and zygotes may outlive the browser process itself by a moment.
  const kill = () => {
    if (!child.pid) return;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL'); } catch { /* gone */ }
      }
    }
  };
  const browser = {
    bin, profile, pid: child.pid, port: 0, process: child, stderrTail, _watchdog: watchdog,
    /** Synchronous: kills the browser's process group and removes the profile (the process is exiting). */
    reap() {
      for (const c of [...cdps]) { try { c.close(); } catch { /* closed */ } }
      for (const ws of [...sockets]) { try { ws.close(); } catch { /* closed */ } }
      kill();
      destroyStreams();
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); } catch { /* best effort */ }
      watchdog.trigger();
      release(browser);
    },
    /** Kills the browser and its children, waits for it to exit (5 s at most) and removes the profile. */
    close() {
      closing ||= (async () => {
        for (const c of [...cdps]) { try { c.close(); } catch { /* closed */ } }
        for (const ws of [...sockets]) { try { ws.close(); } catch { /* closed */ } }
        kill();
        if (!exited) await withDeadline(gone, 5000, `${bin} to exit after SIGKILL`).catch(() => {});
        await waitForGroupGone(child.pid, 2000);
        destroyStreams();
        try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* busy */ }
        watchdog.disarm();
        release(browser);
      })();
      return closing;
    },
    /** The browser's first page target, waited for (the browser starts with about:blank). */
    async pageTarget({ timeoutMs: ms = timeoutMs } = {}) {
      const end = Date.now() + ms;
      let last = '';
      while (Date.now() < end) {
        if (exited) throw new Error(`could not start headless Chromium: ${bin} ${exited} before it opened a page${stderrTail() ? `; stderr: ${stderrTail()}` : ''}`);
        try {
          const list = await withDeadline(fetch(`http://127.0.0.1:${browser.port}/json/list`).then(r => r.json()), Math.max(1, end - Date.now()), `the page list of ${bin}`);
          const page = list.find(t => t.type === 'page');
          if (page) return page;
        } catch (err) { last = err.message; }
        await waitOrWake(100, gone);
      }
      throw new Error(`could not start headless Chromium: ${bin} opened no page on 127.0.0.1:${browser.port} within ${ms} ms${last ? ` (${last})` : ''}`);
    },
    /** A new page target (a second tab). */
    async newPage(url = 'about:blank') {
      return withDeadline(fetch(`http://127.0.0.1:${browser.port}/json/new?${url}`, { method: 'PUT' }).then(r => r.json()), timeoutMs, `a new tab in ${bin}`);
    },
    /** A DevTools connection to `target` (a page target or its id), on 127.0.0.1:<port> only. */
    async connect(target, opts = {}) {
      const id = typeof target === 'string' ? target : target?.id;
      if (!id || !/^[\w-]+$/.test(id)) throw new Error(`not a page target: ${JSON.stringify(target)?.slice(0, 200)}`);
      const cdp = await connectCdp(`ws://127.0.0.1:${browser.port}/devtools/page/${id}`, { timeoutMs, sendTimeoutMs: cdpTimeoutMs, ...opts });
      cdps.add(cdp);
      sockets.add(cdp.ws);
      cdp.ws.addEventListener('close', () => { sockets.delete(cdp.ws); cdps.delete(cdp); });
      // The preload script before any page script, in every document this page opens from now on.
      if (preloadScript) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: preloadScript });
      return cdp;
    },
    /** A connection to the first page. */
    async openPage(opts) { return browser.connect(await browser.pageTarget(), opts); },
  };
  hold(browser);
  try {
    const end = Date.now() + timeoutMs;
    while (!browser.port) {
      if (exited) throw new Error(`could not start headless Chromium: ${bin} ${exited} before it wrote DevToolsActivePort${stderrTail() ? `; stderr: ${stderrTail()}` : ''}`);
      if (Date.now() >= end) throw new Error(`could not start headless Chromium: ${bin} wrote no DevToolsActivePort within ${timeoutMs} ms${stderrTail() ? `; stderr: ${stderrTail()}` : ''}`);
      try { browser.port = parseInt(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0], 10) || 0; } catch { /* not written yet */ }
      if (!browser.port) await waitOrWake(50, gone);
    }
    return browser;
  } catch (err) {
    await browser.close();
    throw Object.assign(err, { exitCode: 2 });
  }
}

/**
 * A DevTools connection: `{ ws, send(method, params, { timeoutMs }), evaluate(expression, { timeoutMs }), on(method, fn),
 * waitEvent(method, timeoutMs), close() }`. `send` resolves with the whole answer (`result` or `error`), as the scripts
 * read it; `evaluate` with the value (`returnByValue`, `awaitPromise`). Each has a deadline, and fails at once when the
 * connection closes. `on(method, fn)` calls `fn(message)` for every event of that method (`'*'`: every message).
 */
export async function connectCdp(wsUrl, { timeoutMs = LAUNCH_TIMEOUT_MS, sendTimeoutMs = CDP_TIMEOUT_MS } = {}) {
  const u = new URL(wsUrl);
  if (u.hostname !== '127.0.0.1') throw new Error(`DevTools connections go to 127.0.0.1 only, not ${u.host}`);
  const ws = new WebSocket(wsUrl);
  const closeWs = () => { try { ws.close(); } catch { /* closed */ } };
  let openDone = false;
  await withDeadline(new Promise((ok, fail) => {
    const failOpen = err => { if (!openDone) { openDone = true; fail(err); } };
    ws.addEventListener('open', () => { openDone = true; ok(); }, { once: true });
    ws.addEventListener('error', () => failOpen(new Error(`could not open the DevTools socket ${wsUrl}`)), { once: true });
    ws.addEventListener('close', () => failOpen(new Error(`could not open the DevTools socket ${wsUrl}`)), { once: true });
  }), timeoutMs, `the DevTools socket ${wsUrl} to open`, () => { openDone = true; closeWs(); }).catch(err => { closeWs(); throw err; });
  let seq = 0, closed = '';
  const pending = new Map(), listeners = new Map(), waiters = new Set();
  const failAll = () => {
    if (closed) return;
    closed = 'the DevTools connection closed';
    for (const p of pending.values()) p.fail(Object.assign(new Error(`${closed} while waiting for ${p.what}`), { code: 'SESSION_CLOSED' }));
    pending.clear();
    for (const w of [...waiters]) w.fail(Object.assign(new Error(`${closed} while waiting for ${w.what}`), { code: 'SESSION_CLOSED' }));
    waiters.clear();
    listeners.clear();
  };
  ws.addEventListener('message', ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p.ok(m); }
    if (m.method) for (const fn of listeners.get(m.method) || []) fn(m);
    for (const fn of listeners.get('*') || []) fn(m);
  });
  ws.addEventListener('close', failAll);
  ws.addEventListener('error', failAll);
  const short = s => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > 80 ? `${t.slice(0, 77)}…` : t; };
  const send = (method, params = {}, { timeoutMs: ms = sendTimeoutMs } = {}) => {
    const what = method === 'Runtime.evaluate' ? `Runtime.evaluate of ${short(params.expression)}` : `the answer to ${method}`;
    if (closed) return Promise.reject(Object.assign(new Error(`${closed} before ${what}`), { code: 'SESSION_CLOSED' }));
    const i = ++seq;
    return withDeadline(new Promise((ok, fail) => { pending.set(i, { ok, fail, what }); ws.send(JSON.stringify({ id: i, method, params })); }), ms, what, () => pending.delete(i));
  };
  const on = (method, fn) => { listeners.set(method, [...(listeners.get(method) || []), fn]); return () => listeners.set(method, (listeners.get(method) || []).filter(f => f !== fn)); };
  return {
    ws, send, on,
    evaluate: async (expression, opts) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, opts)).result?.result?.value,
    /** The next `method` event, or a deadline error naming it. */
    waitEvent: (method, ms = sendTimeoutMs) => {
      const what = `the event ${method}`;
      if (closed) return Promise.reject(Object.assign(new Error(`${closed} before ${what}`), { code: 'SESSION_CLOSED' }));
      let off, entry;
      const drop = () => { off?.(); if (entry) waiters.delete(entry); };
      return withDeadline(new Promise((ok, fail) => {
        entry = { what, fail: err => { drop(); fail(err); } };
        waiters.add(entry);
        off = on(method, m => { drop(); ok(m); });
      }), ms, what, drop);
    },
    close: () => { failAll(); closeWs(); },
  };
}

/**
 * Launch and connect to the first page in one step: the connection, with `browser` and a `close()` that closes the
 * connection and the browser. A failure after the launch closes the browser before it rejects.
 */
export async function openPage(opts = {}) {
  const browser = await launchBrowser(opts);
  try {
    const page = await browser.openPage();
    return { ...page, browser, close: () => { page.close(); return browser.close(); } };
  } catch (err) {
    await browser.close();
    throw Object.assign(err, { exitCode: 2 });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Firefox (BROWSER=firefox) over WebDriver BiDi.
//
// launchFirefox starts `findFirefox()` headless with --no-remote and a fresh profile under the temporary directory
// (removed on close; never the user's profile), on --remote-debugging-port=0 (Firefox picks a free port and prints
// "WebDriver BiDi listening on ws://127.0.0.1:<port>", the only place the port is read from). close(), reap(), and the
// SIGKILL watchdog signal the browser's own detached process group (-child.pid), never another Firefox. Only 127.0.0.1 is
// connected to. One BiDi session per browser (Firefox accepts one); each page (browsing context) is a CDP-shaped object.
// For the keyboard (a focused <button> clicks on Enter and Space, as with a person's keyboard) the first tab starts on
// FIREFOX_START_PAGE, not exactly about:blank, and is activated (browsingContext.activate) once the session is up; no
// preference is set (no user.js): fonts, colours, scrollbars and animation are Firefox's own.
//
// The CDP calls the tests make, and their BiDi translation (FIREFOX_CDP_METHODS):
//   Page.enable, Runtime.enable, Log.enable  -> session.subscribe(log.entryAdded), once per session; turns on that
//                                              domain's CDP events for the page, as in CDP
//   Page.navigate                            -> browsingContext.navigate (wait: 'complete'), then Page.loadEventFired
//                                              (not for a fragment-only change: CDP fires none there either)
//   Page.reload                              -> browsingContext.reload (wait: 'complete'), then Page.loadEventFired
//   Runtime.evaluate                         -> script.evaluate (awaitPromise, target: the page's context); the answer in
//                                              CDP's { result: { type, value, description }, exceptionDetails } shape
//   Emulation.setDeviceMetricsOverride       -> browsingContext.setViewport (width, height, devicePixelRatio)
//   Emulation.clearDeviceMetricsOverride     -> browsingContext.setViewport (viewport: null, devicePixelRatio: null)
//   Page.captureScreenshot                   -> browsingContext.captureScreenshot (origin viewport, or document with a
//                                              clip or captureBeyondViewport)
//   Input.dispatchKeyEvent                   -> input.performActions (one key down or up)
//   log.entryAdded (BiDi event)              -> Runtime.consoleAPICalled (type 'console'), Runtime.exceptionThrown
//                                              (type 'javascript', level error), Log.entryAdded (the other javascript
//                                              entries: warnings, and the failed loads of FIREFOX_NETWORK_ERRORS, as
//                                              network entries); "The connection to … was interrupted while the page
//                                              was loading" is dropped
// Anything else (Performance.*, Emulation.setCPUThrottlingRate, …) rejects: "<method> is not available in Firefox".

/** The one message Firefox logs for a stream a navigation cut (an EventSource or fetch still open): dropped. */
export const FIREFOX_INTERRUPTED = /^The connection to .+ was interrupted while the page was loading\.?$/;
/**
 * Firefox 128 ESR's BiDi preload wrapper (`(${fn}).apply(__bidi_this, __bidi_args)` in Realm.sys.mjs) can still re-fire
 * on back-to-back `about:blank` navigations in an outgoing sandbox whose prototype switched to a new null-principal
 * window, emitting a stackless javascript error naming BiDi's own `__bidi_args`/`__bidi_this` binding. Dropped only when
 * `type === 'javascript'` and there are no page call frames; page errors (including any page "Permission denied") pass through.
 */
export const FIREFOX_BIDI_PRELOAD_ERROR = /^SecurityError: Permission denied to access property "__bidi_(?:args|this)" on cross-origin object$/;
/**
 * Firefox logs a load that failed (an EventSource or WebSocket refused, a script that did not load) as a javascript
 * error; Chromium reports the same failure as a network entry of the Log domain, never as Runtime.exceptionThrown. So
 * these become Log.entryAdded with source 'network' (seen in Firefox 159: an EventSource to a fixture that refuses it).
 */
export const FIREFOX_NETWORK_ERRORS = [/^Firefox can(?:’|')t establish a connection to the server at /, /^Loading failed for the (?:<script>|module) with source /];

/**
 * The first tab's page when the callers ask for about:blank (or give no page): about:blank itself, with a fragment.
 * Firefox puts the keyboard focus in its address bar, not in the page, when the window starts on exactly "about:blank"
 * (browser-init.js _setInitialFocus, isBlankPageURL); no preference changes that, and browsingContext.activate does not
 * move it. Every key the tests send then reaches the page's focused element as events only: a focused <button> got
 * keydown, keypress and keyup for Enter and Space but no click (Firefox 159). Any other start page gets the focus.
 */
export const FIREFOX_START_PAGE = 'about:blank#start';

/**
 * Firefox's command line for the Chromium-style `args` the callers pass: --headless, --no-remote, the private profile
 * and port 0 first; `--window-size=W,H` becomes `--width W --height H`; every other `--flag` is a Chromium flag and is
 * left out (--no-sandbox, --disable-gpu, --hide-scrollbars, --headless=new, …); the rest (the start URL) is kept, but
 * about:blank, or no start URL at all (Firefox's home page), becomes FIREFOX_START_PAGE.
 */
export function firefoxArgs(args, profile) {
  if (args.some(a => /^--?(?:remote-debugging-port|user-data-dir|profile|P)(?:=|$)/.test(a))) throw new Error('launchBrowser adds --remote-debugging-port=0 and --profile itself');
  const size = args.map(a => /^--window-size=(\d+),(\d+)$/.exec(a)).find(Boolean);
  const pages = args.filter(a => !a.startsWith('-')).map(a => (a === 'about:blank' ? FIREFOX_START_PAGE : a));
  return ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port=0',
    ...(size ? ['--width', size[1], '--height', size[2]] : []), ...(pages.length ? pages : [FIREFOX_START_PAGE])];
}

/** The BiDi WebSocket URL in Firefox's output, or ''. */
export function bidiUrlIn(output) {
  return /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(output)?.[1] || '';
}

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsFrame(opcode, payload = Buffer.alloc(0)) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = data.length;
  const headLen = len < 126 ? 2 : len <= 0xffff ? 4 : 10;
  const out = Buffer.allocUnsafe(headLen + 4 + len);
  out[0] = 0x80 | (opcode & 0x0f);
  if (len < 126) {
    out[1] = 0x80 | len;
  } else if (len <= 0xffff) {
    out[1] = 0x80 | 126;
    out.writeUInt16BE(len, 2);
  } else {
    out[1] = 0x80 | 127;
    out.writeBigUInt64BE(BigInt(len), 2);
  }
  const mask = randomBytes(4);
  mask.copy(out, headLen);
  for (let i = 0; i < len; i++) out[headLen + 4 + i] = data[i] ^ mask[i & 3];
  return out;
}

/**
 * A loopback RFC 6455 WebSocket over `node:http` (`agent: false`) whose underlying TCP socket can be destroyed
 * immediately in any state (CONNECTING, OPEN, or CLOSING), unlike WHATWG `WebSocket.close()` which leaves a ref'd
 * socket in CLOSING when a peer never sends a close frame.
 */
function openLocalWebSocket(wsUrl) {
  const u = new URL(wsUrl);
  const key = randomBytes(16).toString('base64');
  const wantAccept = createHash('sha1').update(key + WS_GUID).digest('base64');
  const listeners = new Map();
  let state = 0; // 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED
  let sock = null, closeTimer = null, closedEmitted = false;
  let chunks = [], buffered = 0, fragments = null;

  const removeEventListener = (type, fn) => {
    const list = listeners.get(type);
    if (!list) return;
    const next = list.filter(x => x.fn !== fn);
    if (next.length) listeners.set(type, next); else listeners.delete(type);
  };
  const addEventListener = (type, fn, opts) => {
    const list = listeners.get(type) || [];
    list.push({ fn, once: Boolean(opts?.once) });
    listeners.set(type, list);
  };
  const emit = (type, ev) => {
    const list = listeners.get(type);
    if (!list?.length) return;
    for (const item of [...list]) {
      if (item.once) removeEventListener(type, item.fn);
      item.fn(ev);
    }
  };
  const emitClose = (code = 1006, wasClean = false) => {
    if (closedEmitted) return;
    closedEmitted = true;
    state = 3;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    emit('close', { code, reason: '', wasClean });
    listeners.clear();
  };
  const terminate = (code = 1006, wasClean = false) => {
    if (state === 3 && closedEmitted) return;
    state = 3;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    try { req.destroy(); } catch { /* closed */ }
    try { sock?.unref?.(); sock?.destroy(); } catch { /* closed */ }
    emitClose(code, wasClean);
  };
  const fail = err => {
    if (state === 3) return;
    emit('error', { message: err?.message || String(err), error: err });
    terminate(1006, false);
  };
  const close = () => {
    if (state === 3) return;
    if (state === 0) { terminate(1006, false); return; }
    if (state === 1) {
      state = 2;
      try { if (sock && !sock.destroyed && sock.writable) sock.write(wsFrame(8)); } catch { /* closing */ }
      try { sock?.unref?.(); } catch { /* closed */ }
      closeTimer = setTimeout(() => terminate(1006, false), 200);
      closeTimer.unref?.();
    } else if (state === 2) {
      try { sock?.unref?.(); } catch { /* closed */ }
    }
  };
  const consume = n => {
    if (chunks.length === 1 && chunks[0].length === n) { const out = chunks[0]; chunks = []; buffered = 0; return out; }
    const whole = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, buffered);
    const out = whole.subarray(0, n);
    const rest = whole.subarray(n);
    chunks = rest.length ? [rest] : [];
    buffered = rest.length;
    return out;
  };
  const peek = n => {
    if (chunks[0].length >= n) return chunks[0].subarray(0, n);
    // Copy only the first n header bytes (<=10) so incomplete multi-MB frames never cause quadratic re-concatenation.
    const out = Buffer.allocUnsafe(n);
    let off = 0;
    for (const c of chunks) {
      const take = Math.min(n - off, c.length);
      c.copy(out, off, 0, take);
      off += take;
      if (off >= n) break;
    }
    return out;
  };
  const feed = chunk => {
    if (!chunk?.length || state === 3) return;
    chunks.push(chunk);
    buffered += chunk.length;
    while (buffered >= 2 && state !== 3) {
      const h2 = peek(2);
      if (h2[0] & 0x70) { fail(new Error('WebSocket protocol error: unexpected RSV bits')); return; }
      const fin = (h2[0] & 0x80) !== 0;
      const op = h2[0] & 0x0f;
      if ((h2[1] & 0x80) !== 0) { fail(new Error('WebSocket protocol error: masked server frame')); return; }
      let len = h2[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (buffered < 4) return;
        len = peek(4).readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (buffered < 10) return;
        const big = peek(10).readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) { fail(new Error('WebSocket frame too large')); return; }
        len = Number(big);
        at = 10;
      }
      const need = at + len;
      if (buffered < need) return;
      const frameBuf = consume(need);
      const payload = frameBuf.subarray(at, need);
      if (op === 8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        const s = sock;
        if (state === 1 && s && !s.destroyed && s.writable) {
          try { s.end(wsFrame(8)); } catch { /* closing */ }
        }
        try { s?.unref?.(); } catch { /* closed */ }
        emitClose(code, true);
        if (s && !s.destroyed) setTimeout(() => { try { s.destroy(); } catch { /* closed */ } }, 50).unref?.();
        return;
      }
      if (op === 9) {
        if (state === 1 && sock && !sock.destroyed && sock.writable) {
          try { sock.write(wsFrame(10, payload)); } catch { /* closing */ }
        }
        continue;
      }
      if (op === 10) continue;
      if (op === 1 || op === 2) {
        if (fragments) { fail(new Error('WebSocket protocol error: data frame during fragmentation')); return; }
        if (fin) emit('message', { data: payload.toString('utf8') });
        else fragments = [payload];
      } else if (op === 0) {
        if (!fragments) { fail(new Error('WebSocket protocol error: unexpected continuation frame')); return; }
        fragments.push(payload);
        if (fin) { const full = Buffer.concat(fragments); fragments = null; emit('message', { data: full.toString('utf8') }); }
      } else {
        fail(new Error(`WebSocket protocol error: unknown opcode ${op}`));
        return;
      }
    }
  };

  const req = http.request({
    agent: false,
    hostname: u.hostname,
    port: Number(u.port) || 80,
    path: `${u.pathname}${u.search}`,
    method: 'GET',
    headers: {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': key,
    },
  });
  req.on('socket', s => {
    sock = s;
    s.on('error', err => fail(err));
    if (state === 3) { try { s.unref?.(); s.destroy(); } catch { /* closed */ } }
  });
  req.on('upgrade', (res, socket, head) => {
    sock = socket;
    if (state !== 0) { try { socket.unref?.(); socket.destroy(); } catch { /* closed */ } return; }
    if (res.statusCode !== 101 || res.headers['sec-websocket-accept'] !== wantAccept) {
      fail(new Error(`WebSocket upgrade rejected (HTTP ${res.statusCode})`));
      return;
    }
    socket.setNoDelay?.(true);
    state = 1;
    socket.on('data', feed);
    socket.on('end', () => terminate(1006, false));
    socket.on('close', () => terminate(1006, false));
    emit('open', {});
    if (head?.length) setImmediate(() => { if (state === 1) feed(head); });
  });
  req.on('response', res => {
    res.resume();
    fail(new Error(`WebSocket upgrade failed (HTTP ${res.statusCode})`));
  });
  req.on('error', err => fail(err));
  req.on('close', () => { if (state === 0) terminate(1006, false); });
  req.end();

  return {
    CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
    url: wsUrl,
    get readyState() { return state; },
    addEventListener, removeEventListener,
    send(text) {
      if (state !== 1 || !sock || sock.destroyed) throw new Error('WebSocket is not open');
      sock.write(wsFrame(1, Buffer.from(String(text), 'utf8')));
    },
    close,
    terminate,
  };
}

async function launchFirefox({ args = [], timeoutMs = LAUNCH_TIMEOUT_MS, cdpTimeoutMs = CDP_TIMEOUT_MS, preloadScript = null } = {}) {
  // `bin` is ignored: the callers pass a Chromium lookup's result (findChrome, $CHROME).
  const bin = findFirefox();
  const profile = mkdtempSync(join(tmpdir(), 'ibl-bidi-'));
  let ffArgs;
  try { ffArgs = firefoxArgs(args, profile); } catch (err) { rmSync(profile, { recursive: true, force: true }); throw err; }
  let output = '';
  let exited = null;
  // Its own process group, so close(), reap(), and the SIGKILL watchdog kill Firefox and all its content/helper children.
  const child = spawn(bin, ffArgs, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const watchdog = startCleanupWatchdog(child.pid, profile);
  for (const s of [child.stdout, child.stderr]) { s.setEncoding('utf8'); s.on('data', d => { output = (output + d).slice(-8000); }); }
  const ac = new AbortController();
  let session = null, closing = null, first = null;
  const unrefStreams = () => {
    try { child.stdout?._handle?.unref?.(); } catch { /* closed */ }
    try { child.stderr?._handle?.unref?.(); } catch { /* closed */ }
    try { child.unref(); } catch { /* gone */ }
  };
  const destroyStreams = () => {
    try { child.stdout?.destroy(); } catch { /* closed */ }
    try { child.stderr?.destroy(); } catch { /* closed */ }
    try { child.unref(); } catch { /* gone */ }
  };
  const onChildGone = why => {
    if (exited) return;
    exited = why;
    const err = Object.assign(new Error(`headless Firefox ${exited}`), { code: 'BROWSER_EXITED' });
    if (!ac.signal.aborted) ac.abort(err);
    try { session?.fail(err.message, 'BROWSER_EXITED'); } catch { /* closed */ }
    unrefStreams();
  };
  const gone = new Promise(r => {
    child.once('error', err => { onChildGone(`could not be run (${err.code || err.message})`); r(); });
    child.once('exit', (code, signal) => { onChildGone(`exited (${signal ? `signal ${signal}` : `code ${code}`})`); r(); });
  });
  const stderrTail = () => output.trim().split('\n').slice(-5).join('\n').slice(-600);
  // The whole group: Firefox's content, socket, and RDD children may outlive the parent PID if signalled alone.
  const kill = () => {
    if (!child.pid) return;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL'); } catch { /* gone */ }
      }
    }
  };
  const fail = what => new Error(`could not start headless Firefox: ${bin} ${what}${stderrTail() ? `; output: ${stderrTail()}` : ''}`);
  const browser = {
    name: 'firefox', bin, profile, pid: child.pid, port: 0, process: child, stderrTail, _watchdog: watchdog,
    get session() { return session; },
    /** Synchronous: kills the browser's process group and removes the profile (the process is exiting). */
    reap() {
      try { session?.terminate?.(); } catch { /* closed */ }
      kill();
      destroyStreams();
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); } catch { /* best effort */ }
      watchdog.trigger();
      release(browser);
    },
    /** Asks Firefox to close (browser.close), kills its process group if still there after 3 s, removes the profile. */
    close() {
      closing ||= (async () => {
        let askedClose = false;
        if (session && !session.closed && !exited) {
          askedClose = await session.command('browser.close', {}, { timeoutMs: 2000 }).then(() => true, () => false);
        }
        try { session?.terminate?.(); } catch { /* closed */ }
        if (askedClose && !exited) await withDeadline(gone, 3000, `${bin} to close`).catch(() => {});
        kill();
        if (!exited) await withDeadline(gone, 5000, `${bin} to exit after SIGKILL`).catch(() => {});
        await waitForGroupGone(child.pid, 2000);
        destroyStreams();
        try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* busy */ }
        watchdog.disarm();
        release(browser);
      })();
      return closing;
    },
    /** The first tab, as a page target `{ id: <its browsing context>, type: 'page' }`. */
    async pageTarget() { return { id: first, type: 'page' }; },
    /** A new tab (browsingContext.create), as a page target. */
    async newPage(url = 'about:blank') {
      const { context } = await session.command('browsingContext.create', { type: 'tab' }, { timeoutMs });
      if (url && url !== 'about:blank') await session.command('browsingContext.navigate', { context, url, wait: 'complete' }, { timeoutMs: cdpTimeoutMs });
      return { id: context, type: 'page' };
    },
    /** A CDP-shaped page over the browser's one BiDi session, for a target of pageTarget or newPage (or its id). */
    async connect(target, opts = {}) {
      const id = typeof target === 'string' ? target : target?.id;
      if (!id) throw new Error(`not a page target: ${JSON.stringify(target)?.slice(0, 200)}`);
      return createBidiPage(session, id, { sendTimeoutMs: cdpTimeoutMs, ...opts });
    },
    /** A connection to the first tab. */
    async openPage(opts) { return browser.connect(await browser.pageTarget(), opts); },
  };
  hold(browser);
  try {
    const end = Date.now() + timeoutMs;
    let url = '';
    while (!(url = bidiUrlIn(output))) {
      if (exited) throw fail(`${exited} before it said where WebDriver BiDi listens`);
      if (Date.now() >= end) throw fail(`did not say where WebDriver BiDi listens within ${timeoutMs} ms`);
      await waitOrWake(50, gone);
    }
    const u = new URL(url);
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') throw fail(`listens on ${u.host}, not 127.0.0.1`);
    browser.port = Number(u.port);
    session = await connectBidi(`ws://127.0.0.1:${browser.port}/session`, { timeoutMs, sendTimeoutMs: cdpTimeoutMs, signal: ac.signal });
    await session.command('session.new', { capabilities: {} }, { timeoutMs });
    // The preload script before any page script, in every document of every tab of this session.
    // Run in a named BiDi sandbox: in Firefox 128 ESR, ScriptModule.observe('document-element-inserted') matches only
    // the outer window (not innerWindowId), so on same-process navigations the outgoing WindowRealm re-runs preload
    // scripts; without a sandbox its #globalObject is the outer WindowProxy (now pointing to the new inner window) while
    // #globalObjectReference still wraps the old inner window, causing Function.apply(__bidi_this, __bidi_args) to throw
    // `Error: Permission denied to access property "length"`. A sandbox pins both references to the same Cu.Sandbox
    // compartment while the script can still write to the page's origin-scoped localStorage via sandboxPrototype.
    if (preloadScript) await session.command('script.addPreloadScript', { functionDeclaration: `() => { ${preloadScript} }`, sandbox: 'preload' }, { timeoutMs });
    const tree = await session.command('browsingContext.getTree', { maxDepth: 0 }, { timeoutMs });
    first = tree?.contexts?.[0]?.context;
    if (!first) throw fail('opened no tab');
    // The first tab's window is made the active one, so the page gets the keys as a person's keyboard gives them (a
    // focused <button> clicks on Enter and Space). Firefox may have opened another window that took that place: behind a
    // proxy that asks for a password, its log-in prompt (724 by 177; seen in Firefox 159 in a sandbox, before the session
    // was up): document.hasFocus() was false and the keys reached the button as events only, no click. No preference is
    // needed for this (focusmanager.testmode was measured: it changed nothing, with or without the prompt).
    await session.command('browsingContext.activate', { context: first }, { timeoutMs });
    return browser;
  } catch (err) {
    try { session?.terminate?.(); } catch { /* closed */ }
    await browser.close();
    throw Object.assign(err, { exitCode: 2 });
  }
}

/** A WebDriver BiDi session over a WebSocket to 127.0.0.1 (createBidiSession on a WebSocket transport). */
export async function connectBidi(wsUrl, { timeoutMs = LAUNCH_TIMEOUT_MS, sendTimeoutMs = CDP_TIMEOUT_MS, signal } = {}) {
  const u = new URL(wsUrl);
  if (u.hostname !== '127.0.0.1') throw new Error(`WebDriver BiDi connections go to 127.0.0.1 only, not ${u.host}`);
  const openWhat = `the WebDriver BiDi socket ${wsUrl} to open`;
  if (signal?.aborted) {
    const why = signal.reason instanceof Error ? signal.reason.message : String(signal.reason || 'aborted');
    throw Object.assign(new Error(`${why} before ${openWhat}`), { code: signal.reason?.code || 'ABORTED' });
  }
  const ws = openLocalWebSocket(wsUrl);
  let onAbort = null, openDone = false;
  try {
    await withDeadline(new Promise((ok, fail) => {
      const failOpen = err => { if (!openDone) { openDone = true; fail(err); } };
      ws.addEventListener('open', () => { openDone = true; ok(); }, { once: true });
      ws.addEventListener('error', ev => {
        const detail = ev?.message ? `: ${ev.message}` : '';
        failOpen(Object.assign(new Error(`could not open the WebDriver BiDi socket ${wsUrl}${detail}`), { code: ev?.error?.code || 'BIDI_CONNECT' }));
      }, { once: true });
      ws.addEventListener('close', () => failOpen(Object.assign(new Error(`could not open the WebDriver BiDi socket ${wsUrl}: connection closed`), { code: 'BIDI_CONNECT' })), { once: true });
      if (signal) {
        onAbort = () => {
          const why = signal.reason instanceof Error ? signal.reason.message : String(signal.reason || 'aborted');
          openDone = true;
          ws.terminate();
          fail(Object.assign(new Error(`${why} while waiting for ${openWhat}`), { code: signal.reason?.code || 'ABORTED' }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }), timeoutMs, openWhat, () => { openDone = true; ws.terminate(); });
  } catch (err) {
    ws.terminate();
    throw err;
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
  const session = createBidiSession({
    send: text => ws.send(text),
    onMessage: fn => ws.addEventListener('message', ev => fn(ev.data)),
    onClose: fn => ws.addEventListener('close', () => fn()),
    onError: fn => ws.addEventListener('error', ev => fn(ev?.error || new Error(ev?.message || 'socket error'))),
    close: () => ws.close(),
    terminate: () => ws.terminate(),
  }, { sendTimeoutMs });
  session.ws = ws;
  if (signal) {
    const onSessionAbort = () => {
      const why = signal.reason instanceof Error ? signal.reason.message : String(signal.reason || 'aborted');
      session.fail(why, signal.reason?.code || 'ABORTED');
    };
    if (signal.aborted) onSessionAbort();
    else {
      signal.addEventListener('abort', onSessionAbort, { once: true });
      session.onClose(() => signal.removeEventListener('abort', onSessionAbort));
    }
  }
  return session;
}

/**
 * A BiDi session on `transport` (`{ send(text), onMessage(fn), onClose(fn), close(), terminate?() }`): `command(method,
 * params, { timeoutMs, what })` resolves with the answer's `result` and rejects on an error answer (err.bidi = { error,
 * message }), at its deadline, or when the transport closes or fails; `on(fn)` gets every event `{ method, params }`;
 * `subscribe()` subscribes to log.entryAdded once.
 */
export function createBidiSession(transport, { sendTimeoutMs = CDP_TIMEOUT_MS } = {}) {
  let seq = 0, closed = '', closedCode = '', subscribed = null;
  let transportClosed = false, transportTerminated = false;
  const pending = new Map(), listeners = new Set(), closeListeners = new Set();
  const closeTransport = terminate => {
    if (terminate) {
      if (transportTerminated) return;
      transportTerminated = true;
      transportClosed = true;
      try { (transport.terminate || transport.close)?.(); } catch { /* closed */ }
    } else {
      if (transportClosed) return;
      transportClosed = true;
      try { transport.close?.(); } catch { /* closed */ }
    }
  };
  const failAll = (reason = 'the WebDriver BiDi connection closed', code = 'SESSION_CLOSED', { terminate = false } = {}) => {
    const first = !closed;
    closed ||= reason;
    closedCode ||= code;
    if (first) {
      for (const p of pending.values()) p.fail(Object.assign(new Error(`${closed} while waiting for ${p.what}`), { code: closedCode }));
      pending.clear();
      for (const fn of [...closeListeners]) { try { fn(closed, closedCode); } catch { /* best effort */ } }
      closeListeners.clear();
      listeners.clear();
    }
    closeTransport(terminate);
  };
  transport.onMessage(text => {
    let m; try { m = JSON.parse(text); } catch { return; }
    if (m.id != null && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.type === 'error') p.fail(Object.assign(new Error(`${p.method}: ${m.error}: ${m.message}`), { bidi: { error: m.error, message: m.message } }));
      else p.ok(m.result);
      return;
    }
    if (m.type === 'event' || (m.method && m.id == null)) for (const fn of [...listeners]) fn(m);
  });
  transport.onClose(() => failAll('the WebDriver BiDi connection closed', 'SESSION_CLOSED'));
  transport.onError?.(err => failAll(`the WebDriver BiDi connection failed (${err?.message || err})`, err?.code || 'BIDI_ERROR', { terminate: true }));
  const session = {
    get closed() { return closed; },
    get closedCode() { return closedCode; },
    command(method, params = {}, { timeoutMs: ms = sendTimeoutMs, what = `the answer to ${method}` } = {}) {
      if (closed) return Promise.reject(Object.assign(new Error(`${closed} before ${what}`), { code: closedCode || 'SESSION_CLOSED' }));
      const id = ++seq;
      return withDeadline(new Promise((ok, fail) => {
        pending.set(id, { ok, fail, what, method });
        try {
          transport.send(JSON.stringify({ id, method, params }));
        } catch (err) {
          pending.delete(id);
          failAll(`the WebDriver BiDi connection failed (${err?.message || err})`, err?.code || 'BIDI_ERROR', { terminate: true });
          fail(Object.assign(new Error(`${closed} while waiting for ${what}`), { code: closedCode || 'BIDI_ERROR' }));
        }
      }), ms, what, () => pending.delete(id));
    },
    on(fn) {
      if (closed) return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onClose(fn) {
      if (closed) { try { fn(closed, closedCode); } catch { /* best effort */ } return () => {}; }
      closeListeners.add(fn);
      return () => closeListeners.delete(fn);
    },
    subscribe() {
      subscribed ||= session.command('session.subscribe', { events: ['log.entryAdded'] }).catch(err => { subscribed = null; throw err; });
      return subscribed;
    },
    fail(reason, code = 'SESSION_CLOSED') { failAll(reason, code, { terminate: true }); },
    terminate() { failAll('the WebDriver BiDi connection closed', 'SESSION_CLOSED', { terminate: true }); },
    close() { failAll('the WebDriver BiDi connection closed', 'SESSION_CLOSED'); },
  };
  return session;
}

// ---- BiDi values -> CDP remote objects ----

const SPECIAL_NUMBERS = { NaN: NaN, '-0': -0, Infinity: Infinity, '-Infinity': -Infinity };

/**
 * A BiDi serialized value as the JS value CDP's `returnByValue` gives (a JSON copy): primitives as they are; NaN,
 * ±Infinity → null and -0 → 0 inside arrays and objects; undefined → null in an array and left out of an object;
 * arrays and plain objects element by element; a Date its ISO string; Map, Set, RegExp, Error, nodes, windows → {};
 * functions and symbols → undefined; a bigint → null (CDP cannot carry one by value either). An object seen twice
 * (BiDi's internalId) is the same value; a cycle's back reference is {}.
 */
export function bidiToJs(rv, seen = new Map()) {
  if (!rv || typeof rv !== 'object') return undefined;
  if (rv.internalId && !('value' in rv) && rv.type !== 'undefined' && rv.type !== 'null') return seen.has(rv.internalId) ? seen.get(rv.internalId) : {};
  const keep = v => { if (rv.internalId) seen.set(rv.internalId, v); return v; };
  switch (rv.type) {
    case 'undefined': return undefined;
    case 'null': return null;
    case 'string': case 'boolean': return rv.value;
    case 'number': {
      const n = typeof rv.value === 'number' ? rv.value : SPECIAL_NUMBERS[rv.value];
      return Number.isFinite(n) ? (Object.is(n, -0) ? 0 : n) : null;
    }
    case 'bigint': return null;
    // Kept once built: a back reference met while building (a cycle) is not there yet, and becomes {}.
    case 'array': return keep((rv.value || []).map(v => { const x = bidiToJs(v, seen); return x === undefined ? null : x; }));
    case 'object': {
      const out = {};
      for (const [k, v] of rv.value || []) {
        const x = bidiToJs(v, seen);
        if (x !== undefined) out[typeof k === 'string' ? k : String(bidiToJs(k, seen))] = x;
      }
      return keep(out);
    }
    case 'date': return rv.value;
    case 'function': case 'symbol': return undefined;
    default: return keep({});
  }
}

const CDP_SUBTYPES = { array: 'array', null: 'null', regexp: 'regexp', date: 'date', map: 'map', set: 'set', weakmap: 'weakmap', weakset: 'weakset', error: 'error', promise: 'promise', typedarray: 'typedarray', arraybuffer: 'arraybuffer', node: 'node', generator: 'generator', proxy: 'proxy' };

/**
 * A BiDi serialized value as a CDP RemoteObject `{ type, subtype?, value?, unserializableValue?, description? }`.
 * `byValue` (Runtime.evaluate's returnByValue): objects carry `value` (bidiToJs); without it (console arguments) only
 * primitives do, as in CDP. No objectId or preview is ever given: BiDi handles are not kept.
 */
export function toCdpRemote(rv, { byValue = true, errorText = '' } = {}) {
  const type = rv?.type;
  if (type === 'undefined' || !type) return { type: 'undefined' };
  if (type === 'null') return { type: 'object', subtype: 'null', value: null };
  if (type === 'string' || type === 'boolean') return { type, value: rv.value };
  if (type === 'number') {
    if (typeof rv.value === 'number' && !Object.is(rv.value, -0)) return { type, value: rv.value, description: String(rv.value) };
    return { type, unserializableValue: String(rv.value), description: String(rv.value) };
  }
  if (type === 'bigint') return { type, unserializableValue: `${rv.value}n`, description: `${rv.value}n` };
  if (type === 'symbol') return { type, description: 'Symbol()' };
  if (type === 'function') return { type, className: 'Function', description: 'function' };
  const subtype = CDP_SUBTYPES[type];
  const description = type === 'array' ? `Array(${rv.value?.length ?? 0})` : type === 'object' ? 'Object' : type === 'error' ? (errorText || 'Error') : type === 'date' ? String(rv.value ?? 'Date') : type;
  const out = { type: 'object', ...(subtype ? { subtype } : {}), description };
  if (byValue) out.value = bidiToJs(rv);
  return out;
}

/** A BiDi stack trace `{ callFrames: [{ url, functionName, lineNumber, columnNumber }] }` in CDP's shape. */
const cdpStack = st => (st?.callFrames ? { callFrames: st.callFrames.map(f => ({ functionName: f.functionName || '', scriptId: '', url: f.url || '', lineNumber: f.lineNumber ?? 0, columnNumber: f.columnNumber ?? 0 })) } : undefined);

const CONSOLE_TYPES = { warn: 'warning', group: 'startGroup', groupCollapsed: 'startGroupCollapsed', groupEnd: 'endGroup' };
const LOG_LEVELS = { debug: 'verbose', info: 'info', warn: 'warning', error: 'error' };
// WebDriver's key values for the named keys a CDP key event can carry (a one-character key is itself).
const KEY_VALUES = { Enter: '\uE007', Tab: '\uE004', Escape: '\uE00C', Backspace: '\uE003', Delete: '\uE017', Insert: '\uE016', Home: '\uE011', End: '\uE010',
  PageUp: '\uE00E', PageDown: '\uE00F', ArrowLeft: '\uE012', ArrowUp: '\uE013', ArrowRight: '\uE014', ArrowDown: '\uE015', Shift: '\uE008', Control: '\uE009', Alt: '\uE00A',
  Meta: '\uE03D', ' ': ' ' };

/** The CDP methods a Firefox page translates (the others reject with "not available in Firefox"). */
export const FIREFOX_CDP_METHODS = Object.freeze(['Page.enable', 'Runtime.enable', 'Log.enable', 'Page.navigate', 'Page.reload', 'Runtime.evaluate',
  'Emulation.setDeviceMetricsOverride', 'Emulation.clearDeviceMetricsOverride', 'Page.captureScreenshot', 'Input.dispatchKeyEvent']);

const withoutHash = url => String(url || '').replace(/#.*$/, '');

/** How long `browsingContext.setViewport` may sit unanswered before nudging Firefox 128's resize listener (ms). */
export const VIEWPORT_NUDGE_MS = 150;

/**
 * A CDP-shaped page over a BiDi `session` (createBidiSession) for the browsing context `context`: `{ ws, context, send,
 * on, evaluate, waitEvent, close }`, as connectCdp's. `send(method, params, { timeoutMs })` resolves with the whole CDP
 * answer `{ id, result }` (or `{ id, error }` when Firefox refused the command), and rejects for a method with no
 * translation, at its deadline, or when the connection closed. Events come as CDP's `{ method, params }`, only for the
 * domains enabled (Page, Runtime, Log) and only this context's.
 */
export function createBidiPage(session, context, { sendTimeoutMs = CDP_TIMEOUT_MS, viewportNudgeMs = VIEWPORT_NUDGE_MS } = {}) {
  let seq = 0, closed = '', closedCode = '', exceptions = 0;
  let lastUrl = 'about:blank';
  const enabled = new Set(), listeners = new Map(), waiters = new Set(), activeCleanups = new Set();
  const emit = m => {
    for (const fn of listeners.get(m.method) || []) fn(m);
    for (const fn of listeners.get('*') || []) fn(m);
  };
  const event = (domain, method, params) => { if (!closed && enabled.has(domain)) emit({ method, params }); };
  const off = session.on(m => {
    if (m.method !== 'log.entryAdded') return;
    const p = m.params || {};
    if (p.source?.context && p.source.context !== context) return;
    if (FIREFOX_INTERRUPTED.test(String(p.text ?? ''))) return;
    if (p.type === 'javascript' && !p.stackTrace?.callFrames?.length && FIREFOX_BIDI_PRELOAD_ERROR.test(String(p.text ?? ''))) return;
    const timestamp = p.timestamp, stackTrace = cdpStack(p.stackTrace), top = p.stackTrace?.callFrames?.[0];
    if (p.type === 'console') {
      const args = p.args || [];
      event('Runtime', 'Runtime.consoleAPICalled', { type: CONSOLE_TYPES[p.method] || p.method || 'log', args: args.map(a => toCdpRemote(a, { byValue: false, errorText: args.length === 1 ? p.text : '' })), executionContextId: 0, timestamp, ...(stackTrace ? { stackTrace } : {}) });
    } else if (p.type === 'javascript' && p.level === 'error' && !FIREFOX_NETWORK_ERRORS.some(re => re.test(String(p.text ?? '')))) {
      // CDP's text is "Uncaught"; the error itself is exception.description ("TypeError: x is undefined").
      event('Runtime', 'Runtime.exceptionThrown', { timestamp, exceptionDetails: { exceptionId: ++exceptions, text: 'Uncaught', lineNumber: top?.lineNumber ?? 0, columnNumber: top?.columnNumber ?? 0, url: top?.url, ...(stackTrace ? { stackTrace } : {}),
        exception: { type: 'object', subtype: 'error', className: 'Error', description: String(p.text ?? '') } } });
    } else {
      const network = FIREFOX_NETWORK_ERRORS.some(re => re.test(String(p.text ?? '')));
      event('Log', 'Log.entryAdded', { entry: { source: network ? 'network' : p.type === 'javascript' ? 'javascript' : 'other', level: LOG_LEVELS[p.level] || p.level, text: String(p.text ?? ''), timestamp, url: top?.url, lineNumber: top?.lineNumber, ...(stackTrace ? { stackTrace } : {}) } });
    }
  });
  let offClose = null;
  const failPage = (reason, code = 'SESSION_CLOSED') => {
    if (closed) return;
    closed = reason;
    closedCode = code;
    off();
    offClose?.();
    offClose = null;
    for (const w of [...waiters]) w.fail(Object.assign(new Error(`${closed} while waiting for ${w.what}`), { code }));
    waiters.clear();
    for (const cancel of [...activeCleanups]) { try { cancel(closed, code); } catch { /* best effort */ } }
    activeCleanups.clear();
    listeners.clear();
  };
  offClose = session.onClose?.((reason, code) => failPage(reason, code));
  const loaded = () => event('Page', 'Page.loadEventFired', { timestamp: Date.now() / 1000 });
  const enable = async domain => { await session.subscribe(); enabled.add(domain); return {}; };
  // Firefox 128 ESR's browsingContext.setViewport has two hangs (fixed by Firefox 159):
  // 1. It does not flush remote browser dimensions synchronously before _awaitViewportDimensions waits on
  //    `window.addEventListener('resize', ...)`. On an initial `about:blank` document (`readyState === 'uninitialized'`,
  //    including FIREFOX_START_PAGE), Gecko never dispatches a DOM `resize` event when the dimensions arrive
  //    asynchronously, so setViewport hangs even though innerWidth/innerHeight already match.
  // 2. When resetting (`viewport: null`) after an override wider than the window, Firefox 128 reads
  //    `browser.parentElement.clientWidth` before removing `browser.style.width`, then waits forever for the stretched
  //    width after the browser already shrank back; a second `setViewport` sees matching dimensions and answers at once.
  // Fast answers (under viewportNudgeMs — almost all Firefox 159 and most 128 calls) send no extra command.
  const viewport = (p, opts) => {
    const req = session.command('browsingContext.setViewport', p, opts);
    if (!(viewportNudgeMs > 0)) return req.then(() => ({}));
    return new Promise((resolve, reject) => {
      let settled = false, timer = null, nudges = 0, retries = 0;
      const onCancel = (reason, code) => done(reject, Object.assign(new Error(`${reason} while waiting for ${opts?.what || 'browsingContext.setViewport'}`), { code }));
      const done = (fn, val) => {
        if (settled) return;
        settled = true;
        activeCleanups.delete(onCancel);
        if (timer) { clearTimeout(timer); timer = null; }
        fn(val);
      };
      activeCleanups.add(onCancel);
      req.then(() => done(resolve, {}), err => done(reject, err));
      const w = Number(p.viewport?.width), h = Number(p.viewport?.height);
      const expr = p.viewport && Number.isFinite(w) && Number.isFinite(h)
        ? `(() => { if (window.innerWidth === ${w} && window.innerHeight === ${h}) window.dispatchEvent(new Event('resize')); })()`
        : `(() => { if (document.readyState === 'uninitialized') window.dispatchEvent(new Event('resize')); })()`;
      const probeTimeout = Math.max(1, Math.min(1000, opts?.timeoutMs ?? sendTimeoutMs));
      const schedule = () => {
        if (settled || closed || session.closed) return;
        timer = setTimeout(async () => {
          timer = null;
          if (settled || closed || session.closed) return;
          nudges++;
          await session.command('script.evaluate', { expression: expr, target: { context }, awaitPromise: false }, { timeoutMs: probeTimeout }).catch(() => {});
          if (settled || closed || session.closed) return;
          if (p.viewport === null && nudges >= 2 && retries < 3) {
            retries++;
            try {
              await session.command('browsingContext.setViewport', p, { timeoutMs: probeTimeout, what: opts?.what });
              done(resolve, {});
              return;
            } catch (err) {
              if (err?.bidi) { done(reject, err); return; }
            }
          }
          schedule();
        }, viewportNudgeMs);
        timer.unref?.();
      };
      schedule();
    });
  };
  const METHODS = {
    'Page.enable': () => enable('Page'),
    'Runtime.enable': () => enable('Runtime'),
    'Log.enable': () => enable('Log'),
    'Page.navigate': async ({ url }, opts) => {
      let r;
      try { r = await session.command('browsingContext.navigate', { context, url, wait: 'complete' }, opts); } catch (err) {
        // A network error: CDP answers with errorText, not an error.
        if (err.bidi) return { frameId: context, errorText: err.bidi.message || err.bidi.error };
        throw err;
      }
      const sameDocument = withoutHash(r?.url ?? url) === withoutHash(lastUrl) && /#/.test(String(r?.url ?? url));
      lastUrl = r?.url ?? url;
      if (!sameDocument) loaded();
      return { frameId: context, loaderId: r?.navigation ?? undefined };
    },
    'Page.reload': async ({ ignoreCache } = {}, opts) => {
      await session.command('browsingContext.reload', { context, wait: 'complete', ...(ignoreCache ? { ignoreCache: true } : {}) }, opts);
      loaded();
      return {};
    },
    'Runtime.evaluate': async ({ expression, awaitPromise = false }, opts) => {
      const r = await session.command('script.evaluate', { expression: String(expression), target: { context }, awaitPromise: Boolean(awaitPromise) }, opts);
      if (r?.type === 'exception') {
        const d = r.exceptionDetails || {};
        const description = String(d.text ?? 'Error');
        const exception = d.exception?.type === 'error' || !d.exception ? { type: 'object', subtype: 'error', className: 'Error', description } : { ...toCdpRemote(d.exception), description };
        return { result: exception, exceptionDetails: { exceptionId: ++exceptions, text: 'Uncaught', lineNumber: d.lineNumber ?? 0, columnNumber: d.columnNumber ?? 0, ...(cdpStack(d.stackTrace) ? { stackTrace: cdpStack(d.stackTrace) } : {}), exception } };
      }
      // Firefox evaluates by value always (resultOwnership none): returnByValue false still gets a value, no objectId.
      return { result: toCdpRemote(r?.result) };
    },
    // `mobile` is not carried: BiDi has no mobile emulation (no meta viewport, overlay scrollbars or touch): a phone
    // width is a narrow desktop window. deviceScaleFactor 0 is CDP's "no override".
    'Emulation.setDeviceMetricsOverride': ({ width, height, deviceScaleFactor } = {}, opts) => viewport({ context, viewport: width > 0 && height > 0 ? { width, height } : null,
      ...(deviceScaleFactor === undefined ? {} : { devicePixelRatio: deviceScaleFactor > 0 ? deviceScaleFactor : null }) }, opts),
    'Emulation.clearDeviceMetricsOverride': (_, opts) => viewport({ context, viewport: null, devicePixelRatio: null }, opts),
    'Page.captureScreenshot': async ({ format = 'png', quality, clip, captureBeyondViewport } = {}, opts) => {
      const r = await session.command('browsingContext.captureScreenshot', { context, origin: clip || captureBeyondViewport ? 'document' : 'viewport',
        ...(format !== 'png' || quality !== undefined ? { format: { type: `image/${format}`, ...(quality !== undefined ? { quality: quality / 100 } : {}) } } : {}),
        ...(clip ? { clip: { type: 'box', x: clip.x, y: clip.y, width: clip.width, height: clip.height } } : {}) }, opts);
      return { data: r?.data };
    },
    'Input.dispatchKeyEvent': async ({ type, key, text } = {}, opts) => {
      // 'char' types its text in CDP; in WebDriver the key down already does: nothing to send.
      if (type === 'char') return {};
      const value = KEY_VALUES[key] ?? ([...String(key ?? '')].length === 1 ? key : [...String(text ?? '')].length === 1 ? text : null);
      if (value == null) throw new Error(`Input.dispatchKeyEvent: the key ${JSON.stringify(key)} has no WebDriver key value (browser-launch.mjs KEY_VALUES)`);
      await session.command('input.performActions', { context, actions: [{ type: 'key', id: 'ibl-keyboard', actions: [{ type: type === 'keyUp' ? 'keyUp' : 'keyDown', value }] }] }, opts);
      return {};
    },
  };
  const short = s => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > 80 ? `${t.slice(0, 77)}…` : t; };
  const send = (method, params = {}, { timeoutMs: ms = sendTimeoutMs } = {}) => {
    const what = method === 'Runtime.evaluate' ? `Runtime.evaluate of ${short(params?.expression)}` : `the answer to ${method}`;
    const gone = closed || session.closed;
    if (gone) return Promise.reject(Object.assign(new Error(`${gone} before ${what}`), { code: closedCode || session.closedCode || 'SESSION_CLOSED' }));
    const run = METHODS[method];
    if (!run) return Promise.reject(new Error(`${method} is not available in Firefox (WebDriver BiDi): browser-launch.mjs translates only ${FIREFOX_CDP_METHODS.join(', ')}`));
    const id = ++seq;
    const answer = m => { emit(m); return m; };
    // Run at once (as connectCdp writes at once), so a connection that closes after this call fails it as "while waiting".
    let started;
    try { started = Promise.resolve(run(params || {}, { timeoutMs: ms, what })); } catch (err) { started = Promise.reject(err); }
    return started.then(
      result => answer({ id, result }),
      err => (err.bidi ? answer({ id, error: { code: -32000, message: err.message } }) : Promise.reject(err)));
  };
  const on = (method, fn) => { listeners.set(method, [...(listeners.get(method) || []), fn]); return () => listeners.set(method, (listeners.get(method) || []).filter(f => f !== fn)); };
  return {
    ws: session.ws, context, send, on,
    evaluate: async (expression, opts) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, opts)).result?.result?.value,
    /** The next `method` event, or a deadline error naming it. */
    waitEvent: (method, ms = sendTimeoutMs) => {
      const what = `the event ${method}`;
      const gone = closed || session.closed;
      if (gone) return Promise.reject(Object.assign(new Error(`${gone} before ${what}`), { code: closedCode || session.closedCode || 'SESSION_CLOSED' }));
      let un, entry;
      const drop = () => { un?.(); if (entry) waiters.delete(entry); };
      return withDeadline(new Promise((ok, fail) => {
        entry = { what, fail: err => { drop(); fail(err); } };
        waiters.add(entry);
        un = on(method, m => { drop(); ok(m); });
      }), ms, what, drop);
    },
    /** Stops this page's events and commands; the session (and the browser) stay for the other pages. */
    close: () => failPage('the page was closed', 'PAGE_CLOSED'),
  };
}
