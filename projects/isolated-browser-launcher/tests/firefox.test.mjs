// BROWSER=firefox (browser-launch.mjs): tests drive Firefox over WebDriver BiDi through a page with the Chrome DevTools
// Protocol (CDP) shape callers already use. Checked here without a browser: every CDP call a test makes becomes the
// expected BiDi command (a fake transport answers as Firefox would), every BiDi answer and log.entryAdded event comes
// back in the CDP shape the callers read, a CDP method with no translation rejects, Firefox's "interrupted while the
// page was loading" is dropped; a stand-in "Firefox" (a small Node script on 127.0.0.1) proves the launch, the
// arguments, the private profile and close(); and with BROWSER unset the Chromium path is taken, byte for byte, with no
// Firefox looked up. The real-Firefox tests skip where none is installed.
//
// The shapes callers read, from two of them:
//   const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
//   if (r.result?.exceptionDetails) throw new Error(`page script: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
//   return r.result?.result?.value;
// and the console log reader: Runtime.consoleAPICalled with m.params.type and m.params.args, plus
// fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64')) for screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http, { createServer } from 'node:http';
import crypto from 'node:crypto';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  FIREFOX_CDP_METHODS, FIREFOX_START_PAGE, bidiToJs, bidiUrlIn, browserFromEnv, createBidiPage, createBidiSession, findFirefox, firefoxArgs, openPage, toCdpRemote,
} from '../browser-launch.mjs';
// The first line of a page exception, as a caller reports it.
const exceptionText = m => String(m?.params?.exceptionDetails?.exception?.description
  || m?.params?.exceptionDetails?.text || 'exception').split('\n')[0];
// A script that writes a value under a key when the key is empty, as a preload script does for a person's saved choice.
const PRELOAD_KEY = 'example:v1:view';
const preloadChoice = choice => `try { if (!localStorage.getItem(${JSON.stringify(PRELOAD_KEY)})) localStorage.setItem(${JSON.stringify(PRELOAD_KEY)}, ${JSON.stringify(JSON.stringify({ view: choice }))}); } catch { /* no storage here (about:blank) */ }`;

const HERE = dirname(fileURLToPath(import.meta.url));
// Written in parts so that no line of this file passes the flag itself.
const FLAG = ['--remote', 'debugging', 'port'].join('-');
const DIR = mkdtempSync(join(tmpdir(), 'ibl-ff-standin-'));
test.after(() => rmSync(DIR, { recursive: true, force: true }));
const it = (name, fn) => test(name, { timeout: 30_000 }, fn);
const CTX = 'ctx-1';

/**
 * A fake Firefox at the other end of a BiDi transport: `answers[method]` (a value, or a function of the params) is the
 * result; `{ error, message }` makes an error answer; `never` leaves the command unanswered. `sent` is every command.
 */
function fakeFirefox(answers = {}) {
  const sent = [];
  let deliver = () => {}, closed = () => {};
  const transport = {
    send(text) {
      const m = JSON.parse(text);
      sent.push(m);
      const a = typeof answers[m.method] === 'function' ? answers[m.method](m.params) : answers[m.method];
      if (a === 'never') return;
      queueMicrotask(() => deliver(JSON.stringify(a?.error ? { type: 'error', id: m.id, error: a.error, message: a.message } : { type: 'success', id: m.id, result: a ?? {} })));
    },
    onMessage: fn => { deliver = fn; },
    onClose: fn => { closed = fn; },
    close: () => closed(),
  };
  const session = createBidiSession(transport, { sendTimeoutMs: 2000 });
  const page = createBidiPage(session, CTX, { sendTimeoutMs: 2000 });
  return {
    sent, session, page,
    commands: () => sent.map(m => [m.method, m.params]),
    event: (method, params) => deliver(JSON.stringify({ type: 'event', method, params })),
    drop: () => closed(),
  };
}
const tick = () => new Promise(r => setImmediate(r));

it('Page.enable, Runtime.enable and Log.enable: one session.subscribe to log.entryAdded, answered {} each', async () => {
  const ff = fakeFirefox();
  for (const m of ['Page.enable', 'Runtime.enable', 'Log.enable']) assert.deepEqual((await ff.page.send(m)).result, {});
  assert.deepEqual(ff.commands(), [['session.subscribe', { events: ['log.entryAdded'] }]]);
});

it('Page.navigate: browsingContext.navigate (wait complete) on the page\'s context, then Page.loadEventFired; none for a fragment-only change', async () => {
  const ff = fakeFirefox({ 'browsingContext.navigate': p => ({ navigation: 'nav-1', url: p.url }) });
  const loads = [];
  ff.page.on('Page.loadEventFired', m => loads.push(m));
  // Before Page.enable CDP sends no Page events: neither does the adapter.
  await ff.page.send('Page.navigate', { url: 'http://127.0.0.1:8080/start' });
  assert.equal(loads.length, 0);
  await ff.page.send('Page.enable');
  const ev = ff.page.waitEvent('Page.loadEventFired', 1000);
  const r = await ff.page.send('Page.navigate', { url: 'http://127.0.0.1:8080/#/one' });
  assert.deepEqual(r.result, { frameId: CTX, loaderId: 'nav-1' });
  assert.equal(typeof (await ev).params.timestamp, 'number');
  assert.deepEqual(ff.sent.at(-1), { id: ff.sent.at(-1).id, method: 'browsingContext.navigate', params: { context: CTX, url: 'http://127.0.0.1:8080/#/one', wait: 'complete' } });
  // #/one -> #/one/two is the same document: CDP fires no load event there.
  await ff.page.send('Page.navigate', { url: 'http://127.0.0.1:8080/#/one/two' });
  assert.equal(loads.length, 1);
  await ff.page.send('Page.navigate', { url: 'http://127.0.0.1:8081/#/one/two' });
  assert.equal(loads.length, 2);
});

it('Page.navigate refused by Firefox (a network error): CDP\'s errorText in the result, as Chromium answers', async () => {
  const ff = fakeFirefox({ 'browsingContext.navigate': { error: 'unknown error', message: 'NS_ERROR_CONNECTION_REFUSED' } });
  assert.deepEqual((await ff.page.send('Page.navigate', { url: 'http://127.0.0.1:1/' })).result, { frameId: CTX, errorText: 'NS_ERROR_CONNECTION_REFUSED' });
});

it('Page.reload: browsingContext.reload (wait complete), then Page.loadEventFired', async () => {
  const ff = fakeFirefox();
  await ff.page.send('Page.enable');
  const ev = ff.page.waitEvent('Page.loadEventFired', 1000);
  assert.deepEqual((await ff.page.send('Page.reload')).result, {});
  await ev;
  assert.deepEqual(ff.commands().at(-1), ['browsingContext.reload', { context: CTX, wait: 'complete' }]);
});

it('Runtime.evaluate: script.evaluate on the context, awaitPromise carried; the answer in CDP\'s result.result shape', async () => {
  let next = { type: 'success', realm: 'r', result: { type: 'number', value: 2 } };
  const ff = fakeFirefox({ 'script.evaluate': () => next });
  const r = await ff.page.send('Runtime.evaluate', { expression: '1 + 1', returnByValue: true, awaitPromise: true });
  assert.deepEqual(ff.commands().at(-1), ['script.evaluate', { expression: '1 + 1', target: { context: CTX }, awaitPromise: true }]);
  assert.deepEqual(r.result, { result: { type: 'number', value: 2, description: '2' } });
  await ff.page.send('Runtime.evaluate', { expression: 'x' });
  assert.equal(ff.sent.at(-1).params.awaitPromise, false, 'CDP\'s default');
  // A common reader: (await send('Runtime.evaluate', { returnByValue: true, expression })).result?.result?.value
  next = { type: 'success', result: { type: 'object', value: [['sidebar', { type: 'number', value: 240 }], ['page', { type: 'number', value: 272 }], ['overflow', { type: 'number', value: -15 }]] } };
  assert.deepEqual((await ff.page.send('Runtime.evaluate', { returnByValue: true, expression: 'm()' })).result?.result?.value, { sidebar: 240, page: 272, overflow: -15 });
  // evaluate(): the value itself, as connectCdp's.
  next = { type: 'success', result: { type: 'array', value: [{ type: 'string', value: 'a' }, { type: 'null' }, { type: 'boolean', value: true }] } };
  assert.deepEqual(await ff.page.evaluate('[...]'), ['a', null, true]);
  next = { type: 'success', result: { type: 'undefined' } };
  assert.equal(await ff.page.evaluate('void 0'), undefined);
  assert.deepEqual((await ff.page.send('Runtime.evaluate', { expression: 'void 0' })).result, { result: { type: 'undefined' } });
});

it('Runtime.evaluate that throws: exceptionDetails with exception.description, as a caller reads it', async () => {
  const ff = fakeFirefox({ 'script.evaluate': { type: 'exception', realm: 'r', exceptionDetails: { text: 'TypeError: x is undefined', lineNumber: 1, columnNumber: 4, exception: { type: 'error' },
    stackTrace: { callFrames: [{ url: 'http://127.0.0.1/x.js', functionName: 'f', lineNumber: 1, columnNumber: 4 }] } } } });
  const r = await ff.page.send('Runtime.evaluate', { expression: 'x.y', returnByValue: true, awaitPromise: true });
  assert.ok(r.result?.exceptionDetails, 'the caller sees an exception');
  assert.equal(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text, 'TypeError: x is undefined');
  assert.equal(r.result.result.subtype, 'error');
  assert.equal(r.result.exceptionDetails.stackTrace.callFrames[0].functionName, 'f');
  assert.equal(await ff.page.evaluate('x.y'), undefined, 'evaluate() gives no value, as with CDP');
  // A thrown string keeps its value; the description is still Firefox's text.
  const ff2 = fakeFirefox({ 'script.evaluate': { type: 'exception', exceptionDetails: { text: 'uncaught exception: boom', exception: { type: 'string', value: 'boom' } } } });
  const r2 = (await ff2.page.send('Runtime.evaluate', { expression: 'throw "boom"' })).result;
  assert.deepEqual([r2.exceptionDetails.exception.value, r2.exceptionDetails.exception.description], ['boom', 'uncaught exception: boom']);
});

it('BiDi serialized values become the JS values CDP\'s returnByValue gives', () => {
  const n = v => ({ type: 'number', value: v });
  assert.equal(bidiToJs({ type: 'string', value: 's' }), 's');
  assert.equal(bidiToJs(n(1.5)), 1.5);
  assert.equal(bidiToJs({ type: 'null' }), null);
  assert.equal(bidiToJs({ type: 'undefined' }), undefined);
  assert.equal(bidiToJs({ type: 'boolean', value: false }), false);
  // Inside arrays and objects: JSON's rules (NaN and Infinity null, -0 0, undefined null in arrays, left out of objects).
  assert.deepEqual(bidiToJs({ type: 'array', value: [n('NaN'), n('-0'), n('Infinity'), { type: 'undefined' }, n(3)] }), [null, 0, null, null, 3]);
  assert.deepEqual(bidiToJs({ type: 'object', value: [['a', { type: 'undefined' }], ['b', { type: 'object', value: [['c', { type: 'array', value: [] }]] }]] }), { b: { c: [] } });
  assert.deepEqual(bidiToJs({ type: 'object', value: [[n(1), { type: 'string', value: 'one' }]] }), { 1: 'one' });
  assert.equal(bidiToJs({ type: 'date', value: '2026-11-13T00:00:00.000Z' }), '2026-11-13T00:00:00.000Z');
  for (const type of ['map', 'set', 'regexp', 'error', 'node', 'window']) assert.deepEqual(bidiToJs({ type }), {}, type);
  assert.equal(bidiToJs({ type: 'function' }), undefined);
  // The same object twice (BiDi's internalId) is one value; a cycle's back reference is {}.
  const shared = { type: 'object', internalId: '7', value: [['k', n(1)]] };
  assert.deepEqual(bidiToJs({ type: 'array', value: [shared, { type: 'object', internalId: '7' }] }), [{ k: 1 }, { k: 1 }]);
  assert.deepEqual(bidiToJs({ type: 'object', internalId: '8', value: [['self', { type: 'object', internalId: '8' }]] }), { self: {} });
  // At the top: CDP's RemoteObject, with unserializableValue for what JSON cannot carry.
  assert.deepEqual(toCdpRemote(n('NaN')), { type: 'number', unserializableValue: 'NaN', description: 'NaN' });
  assert.deepEqual(toCdpRemote({ type: 'bigint', value: '12' }), { type: 'bigint', unserializableValue: '12n', description: '12n' });
  assert.deepEqual(toCdpRemote({ type: 'null' }), { type: 'object', subtype: 'null', value: null });
  assert.deepEqual(toCdpRemote({ type: 'array', value: [n(1)] }), { type: 'object', subtype: 'array', description: 'Array(1)', value: [1] });
  assert.deepEqual(toCdpRemote({ type: 'object', value: [] }, { byValue: false }), { type: 'object', description: 'Object' });
});

it('Emulation.setDeviceMetricsOverride and clearDeviceMetricsOverride: browsingContext.setViewport; mobile is not carried', async () => {
  const ff = fakeFirefox();
  assert.deepEqual((await ff.page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })).result, {});
  await ff.page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 0, mobile: false });
  await ff.page.send('Emulation.clearDeviceMetricsOverride');
  assert.deepEqual(ff.commands(), [
    ['browsingContext.setViewport', { context: CTX, viewport: { width: 390, height: 844 }, devicePixelRatio: 2 }],
    ['browsingContext.setViewport', { context: CTX, viewport: { width: 1280, height: 900 }, devicePixelRatio: null }],
    ['browsingContext.setViewport', { context: CTX, viewport: null, devicePixelRatio: null }],
  ]);
});

it('Firefox 128 setViewport hangs: nudges resize when unanswered, retries viewport:null after stretched parent, and still honours deadlines', async () => {
  // 1. Stuck setViewport (about:blank#start misses native resize): nudge wakes the original setViewport.
  const sent1 = [];
  let deliver1 = () => {}, closed1 = () => {}, heldId = null;
  const s1 = createBidiSession({
    send(text) {
      const m = JSON.parse(text); sent1.push(m);
      if (m.method === 'browsingContext.setViewport') { heldId = m.id; return; }
      if (m.method === 'script.evaluate') {
        queueMicrotask(() => {
          deliver1(JSON.stringify({ type: 'success', id: m.id, result: { type: 'success', result: { type: 'undefined' } } }));
          if (heldId != null) { const id = heldId; heldId = null; deliver1(JSON.stringify({ type: 'success', id, result: {} })); }
        });
      }
    },
    onMessage: fn => { deliver1 = fn; }, onClose: fn => { closed1 = fn; }, close: () => closed1(),
  }, { sendTimeoutMs: 2000 });
  const p1 = createBidiPage(s1, CTX, { sendTimeoutMs: 2000, viewportNudgeMs: 25 });
  try {
    assert.deepEqual((await p1.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 700, deviceScaleFactor: 1, mobile: false })).result, {});
    assert.deepEqual(sent1.map(m => m.method), ['browsingContext.setViewport', 'script.evaluate']);
    assert.match(sent1[1].params.expression, /window\.innerWidth === 1280 && window\.innerHeight === 700/);
    assert.match(sent1[1].params.expression, /dispatchEvent\(new Event\('resize'\)\)/);
    assert.deepEqual(sent1[1].params.target, { context: CTX });
  } finally { s1.close(); }

  // 2. Stuck clearDeviceMetricsOverride (viewport:null after a wide override): second setViewport resolves it.
  const sent2 = [];
  let deliver2 = () => {}, closed2 = () => {}, vpCalls = 0;
  const s2 = createBidiSession({
    send(text) {
      const m = JSON.parse(text); sent2.push(m);
      if (m.method === 'browsingContext.setViewport') {
        vpCalls++;
        if (vpCalls === 1) return; // first call hangs on stretched parentElement.clientWidth
        queueMicrotask(() => deliver2(JSON.stringify({ type: 'success', id: m.id, result: {} })));
        return;
      }
      if (m.method === 'script.evaluate') queueMicrotask(() => deliver2(JSON.stringify({ type: 'success', id: m.id, result: { type: 'success', result: { type: 'undefined' } } })));
    },
    onMessage: fn => { deliver2 = fn; }, onClose: fn => { closed2 = fn; }, close: () => closed2(),
  }, { sendTimeoutMs: 2000 });
  const p2 = createBidiPage(s2, CTX, { sendTimeoutMs: 2000, viewportNudgeMs: 25 });
  try {
    assert.deepEqual((await p2.send('Emulation.clearDeviceMetricsOverride')).result, {});
    assert.equal(vpCalls, 2, 're-issued browsingContext.setViewport once the resize nudges did not wake it');
    assert.deepEqual(sent2.filter(m => m.method === 'browsingContext.setViewport').map(m => m.params), [
      { context: CTX, viewport: null, devicePixelRatio: null },
      { context: CTX, viewport: null, devicePixelRatio: null },
    ]);
  } finally { s2.close(); }

  // 3. A setViewport that truly never answers still rejects at its deadline.
  const ff3 = fakeFirefox({ 'browsingContext.setViewport': 'never' });
  const p3 = createBidiPage(ff3.session, CTX, { sendTimeoutMs: 2000, viewportNudgeMs: 25 });
  try {
    await assert.rejects(p3.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 700 }, { timeoutMs: 120 }),
      /^Error: timed out after 120 ms waiting for the answer to Emulation\.setDeviceMetricsOverride$/);
  } finally { ff3.drop(); }
});

it('Page.captureScreenshot: browsingContext.captureScreenshot, the viewport, or the document with captureBeyondViewport or a clip; data where a screenshot caller reads it', async () => {
  const ff = fakeFirefox({ 'browsingContext.captureScreenshot': { data: 'iVBORw0KGgo=' } });
  const shot = await ff.page.send('Page.captureScreenshot', { format: 'png' });
  assert.equal(Buffer.from(shot.result.data, 'base64').length, 8);
  await ff.page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await ff.page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1600, height: 3000, scale: 1 } });
  await ff.page.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
  assert.deepEqual(ff.commands(), [
    ['browsingContext.captureScreenshot', { context: CTX, origin: 'viewport' }],
    ['browsingContext.captureScreenshot', { context: CTX, origin: 'document' }],
    ['browsingContext.captureScreenshot', { context: CTX, origin: 'document', clip: { type: 'box', x: 0, y: 0, width: 1600, height: 3000 } }],
    ['browsingContext.captureScreenshot', { context: CTX, origin: 'viewport', format: { type: 'image/jpeg', quality: 0.8 } }],
  ]);
});

it('Input.dispatchKeyEvent (a focused button\'s Enter): input.performActions, key down then key up; a char event sends nothing', async () => {
  const ff = fakeFirefox();
  await ff.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await ff.page.send('Input.dispatchKeyEvent', { type: 'char', text: '\r' });
  await ff.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await ff.page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a' });
  const key = (type, value) => ['input.performActions', { context: CTX, actions: [{ type: 'key', id: 'ibl-keyboard', actions: [{ type, value }] }] }];
  assert.deepEqual(ff.commands(), [key('keyDown', ''), key('keyUp', ''), key('keyDown', 'a')]);
  await assert.rejects(ff.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F13' }), /the key "F13" has no WebDriver key value/);
});

it('log.entryAdded: console -> Runtime.consoleAPICalled, a javascript error -> Runtime.exceptionThrown, a javascript warning -> Log.entryAdded', async () => {
  const ff = fakeFirefox();
  const seen = [];
  ff.page.on('*', m => { if (m.method) seen.push(m); });
  const source = { realm: 'r', context: CTX };
  const consoleError = { type: 'console', level: 'error', method: 'error', source, text: 'bad 42', timestamp: 1, args: [{ type: 'string', value: 'bad' }, { type: 'number', value: 42 }] };
  // Before Runtime.enable: nothing, as in CDP.
  ff.event('log.entryAdded', consoleError);
  assert.equal(seen.length, 0);
  await ff.page.send('Runtime.enable');
  ff.event('log.entryAdded', consoleError);
  ff.event('log.entryAdded', { type: 'console', level: 'warn', method: 'warn', source, text: 'careful', timestamp: 2, args: [{ type: 'string', value: 'careful' }] });
  ff.event('log.entryAdded', { type: 'console', level: 'error', method: 'error', source, text: 'Error: no data', timestamp: 3, args: [{ type: 'error' }] });
  ff.event('log.entryAdded', { type: 'javascript', level: 'error', source, text: 'TypeError: x is undefined', timestamp: 4, stackTrace: { callFrames: [{ url: 'http://127.0.0.1/a.js', functionName: 'g', lineNumber: 9, columnNumber: 2 }] } });
  // A warning in Firefox's console (not an exception in Chromium): Log.entryAdded, only once Log is enabled.
  const warning = { type: 'javascript', level: 'warn', source, text: 'Layout was forced before the page was fully loaded.', timestamp: 5 };
  ff.event('log.entryAdded', warning);
  await ff.page.send('Log.enable');
  ff.event('log.entryAdded', warning);
  // Another tab's entries are that tab's.
  ff.event('log.entryAdded', { ...consoleError, source: { realm: 'r2', context: 'ctx-2' } });
  // A console log reader's view of each:
  const logs = [];
  for (const m of seen) {
    if (m.method === 'Runtime.exceptionThrown') logs.push({ type: 'exception', text: m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text });
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push({ type: m.params.type, text: m.params.args.map(a => a.value ?? a.description).join(' ') });
    if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) logs.push({ type: `log-${m.params.entry.level}`, text: m.params.entry.text });
  }
  assert.deepEqual(logs, [
    { type: 'error', text: 'bad 42' },
    { type: 'warning', text: 'careful' },
    { type: 'error', text: 'Error: no data' },
    { type: 'exception', text: 'TypeError: x is undefined' },
    { type: 'log-warning', text: 'Layout was forced before the page was fully loaded.' },
  ]);
  const thrown = seen.find(m => m.method === 'Runtime.exceptionThrown');
  assert.equal(exceptionText(thrown), 'TypeError: x is undefined');
  assert.deepEqual([thrown.params.exceptionDetails.text, thrown.params.exceptionDetails.lineNumber, thrown.params.exceptionDetails.url], ['Uncaught', 9, 'http://127.0.0.1/a.js']);
});

it('"The connection to … was interrupted while the page was loading" is dropped, and only that message', async () => {
  const ff = fakeFirefox();
  const errors = [];
  ff.page.on('Runtime.exceptionThrown', m => errors.push(exceptionText(m)));
  await ff.page.send('Runtime.enable');
  const source = { realm: 'r', context: CTX };
  ff.event('log.entryAdded', { type: 'javascript', level: 'error', source, timestamp: 1, text: 'The connection to http://127.0.0.1:8080/events was interrupted while the page was loading.' });
  ff.event('log.entryAdded', { type: 'javascript', level: 'error', source, timestamp: 3, text: 'Error: The connection to the server was interrupted while the page was loading the charts' });
  assert.deepEqual(errors, ['Error: The connection to the server was interrupted while the page was loading the charts']);
});

it('Firefox 128 stackless BiDi __bidi_args preload SecurityError is dropped; page Permission denied and framed errors still surface', async () => {
  const ff = fakeFirefox();
  const errors = [];
  ff.page.on('Runtime.exceptionThrown', m => errors.push(exceptionText(m)));
  await ff.page.send('Runtime.enable');
  const source = { realm: 'r', context: CTX };
  ff.event('log.entryAdded', { type: 'javascript', level: 'error', source, timestamp: 1, text: 'SecurityError: Permission denied to access property "__bidi_args" on cross-origin object' });
  ff.event('log.entryAdded', { type: 'javascript', level: 'error', source, timestamp: 2, text: 'Error: Permission denied to access property "length"' });
  ff.event('log.entryAdded', { type: 'javascript', level: 'error', source, timestamp: 3, text: 'SecurityError: Permission denied to access property "__bidi_args" on cross-origin object', stackTrace: { callFrames: [{ url: 'http://127.0.0.1/app.js', functionName: 'f', lineNumber: 1, columnNumber: 1 }] } });
  assert.deepEqual(errors, [
    'Error: Permission denied to access property "length"',
    'SecurityError: Permission denied to access property "__bidi_args" on cross-origin object',
  ]);
});

it('a load Firefox could not make (an EventSource refused) is a network Log entry, as Chromium reports it, not an exception', async () => {
  // Seen on Firefox 159: a fixture that refuses a streaming request logs a warning; Chromium raises no exception for it.
  const ff = fakeFirefox();
  const errors = [], log = [];
  ff.page.on('Runtime.exceptionThrown', m => errors.push(exceptionText(m)));
  ff.page.on('Log.entryAdded', m => log.push(m.params.entry));
  await ff.page.send('Runtime.enable'); await ff.page.send('Log.enable');
  const source = { realm: 'r', context: CTX };
  ff.event('log.entryAdded', { type: 'javascript', level: 'error', source, timestamp: 2, text: 'Firefox can’t establish a connection to the server at http://127.0.0.1:8080/events.' });
  ff.event('log.entryAdded', { type: 'javascript', level: 'error', source, timestamp: 3, text: 'Loading failed for the module with source “http://127.0.0.1:8080/js/x.js”.' });
  assert.deepEqual(errors, []);
  assert.deepEqual(log.map(e => [e.source, e.level]), [['network', 'error'], ['network', 'error']]);
});

it('a CDP method with no translation rejects, naming it and "not available in Firefox"; nothing is sent', async () => {
  const ff = fakeFirefox();
  for (const m of ['Performance.enable', 'Performance.getMetrics', 'Emulation.setCPUThrottlingRate', 'Network.enable', 'Page.disable']) {
    await assert.rejects(ff.page.send(m, {}), err => err instanceof Error && err.message.startsWith(`${m} is not available in Firefox`), m);
  }
  assert.deepEqual(ff.sent, []);
  assert.deepEqual([...FIREFOX_CDP_METHODS].sort(), ['Emulation.clearDeviceMetricsOverride', 'Emulation.setDeviceMetricsOverride', 'Input.dispatchKeyEvent', 'Log.enable', 'Page.captureScreenshot', 'Page.enable', 'Page.navigate', 'Page.reload', 'Runtime.enable', 'Runtime.evaluate']);
});

it('a command Firefox refuses resolves with CDP\'s { error }; a deadline and a closed connection reject, saying what was awaited', async () => {
  const ff = fakeFirefox({ 'browsingContext.setViewport': { error: 'invalid argument', message: 'Expected "devicePixelRatio" to be a positive number' }, 'script.evaluate': 'never' });
  const r = await ff.page.send('Emulation.setDeviceMetricsOverride', { width: 1, height: 1, deviceScaleFactor: -1 });
  assert.match(r.error.message, /browsingContext\.setViewport: invalid argument: Expected "devicePixelRatio"/);
  await assert.rejects(ff.page.send('Runtime.evaluate', { expression: 'document.title' }, { timeoutMs: 200 }), /^Error: timed out after 200 ms waiting for Runtime\.evaluate of document\.title$/);
  const waiting = ff.page.send('Runtime.evaluate', { expression: 'slow()' }, { timeoutMs: 20_000 });
  ff.drop();
  await assert.rejects(waiting, /the WebDriver BiDi connection closed while waiting for Runtime\.evaluate of slow\(\)/);
  await assert.rejects(ff.page.evaluate('1'), /the WebDriver BiDi connection closed before Runtime\.evaluate of 1/);
});

it('Firefox\'s command line: headless, --no-remote, the private profile and port 0; the window size kept, Chromium flags left out; about:blank starts as about:blank#start', () => {
  assert.deepEqual(firefoxArgs(['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--window-size=1280,900', 'about:blank'], '/tmp/ibl-bidi-x'),
    ['--headless', '--no-remote', '--profile', '/tmp/ibl-bidi-x', `${FLAG}=0`, '--width', '1280', '--height', '900', 'about:blank#start']);
  // Exactly "about:blank" (or no page: Firefox's home page) would leave the keyboard in the address bar.
  assert.equal(FIREFOX_START_PAGE, 'about:blank#start');
  assert.deepEqual(firefoxArgs(['--no-sandbox', 'about:blank'], '/p'), ['--headless', '--no-remote', '--profile', '/p', `${FLAG}=0`, 'about:blank#start']);
  assert.deepEqual(firefoxArgs([], '/p'), ['--headless', '--no-remote', '--profile', '/p', `${FLAG}=0`, 'about:blank#start']);
  assert.deepEqual(firefoxArgs(['http://127.0.0.1:8080/'], '/p').at(-1), 'http://127.0.0.1:8080/', 'any other page is kept');
  for (const own of [`${FLAG}=9222`, '--profile', '--profile=/home/someone/.mozilla/firefox/x.default', '-P', '--user-data-dir=/tmp/x']) assert.throws(() => firefoxArgs([own], '/p'), /adds .* itself/, own);
  assert.equal(bidiUrlIn('*** You are running in headless mode.\nWebDriver BiDi listening on ws://127.0.0.1:40123\nRead port: 0\n'), 'ws://127.0.0.1:40123');
  assert.equal(bidiUrlIn('*** You are running in headless mode.\n'), '');
});

it('BROWSER selects the browser: only "firefox" means Firefox; unset, empty or anything else is the Chromium path', () => {
  assert.equal(browserFromEnv(null), 'chromium');
  assert.equal(browserFromEnv(''), 'chromium');
  assert.equal(browserFromEnv('chromium'), 'chromium');
  assert.equal(browserFromEnv('firefox'), 'firefox');
  assert.equal(browserFromEnv(' Firefox '), 'firefox');
  assert.equal(browserFromEnv('/usr/bin/firefox'), 'chromium');
});

// ---- processes: a stand-in Chromium and a stand-in Firefox ----

const runNode = (file, args, env, { timeoutMs = 30_000 } = {}) => new Promise(resolve => {
  const child = spawn(process.execPath, [file, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env });
  let out = '', err = '', timedOut = false;
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  const t = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
  child.once('exit', (code, signal) => { clearTimeout(t); resolve({ code, signal, timedOut, out, err }); });
});

it('BROWSER unset: the Chromium path, its arguments byte for byte; no Firefox is looked up or started', async () => {
  const dir = join(DIR, 'chromium-path');
  mkdirSync(join(dir, 'bin'), { recursive: true });
  const record = join(dir, 'argv.json'), marker = join(dir, 'firefox-ran');
  // A "Chromium" that records its arguments and exits 3; a "Firefox" (FIREFOX_BIN, and firefox-esr / firefox on PATH)
  // that leaves a marker if anything starts it.
  writeFileSync(join(dir, 'chromium'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(3);\n`);
  const ffScript = `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`;
  for (const f of [join(dir, 'firefox-bin'), join(dir, 'bin', 'firefox-esr'), join(dir, 'bin', 'firefox')]) writeFileSync(f, ffScript);
  for (const f of ['chromium', 'firefox-bin', 'bin/firefox-esr', 'bin/firefox']) chmodSync(join(dir, f), 0o755);
  const script = join(dir, 'launch.mjs');
  writeFileSync(script, `
import * as L from ${JSON.stringify(pathToFileURL(join(HERE, '..', 'browser-launch.mjs')).href)};
const err = await L.openPage({ bin: ${JSON.stringify(join(dir, 'chromium'))}, args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,900', 'about:blank'], timeoutMs: 10_000 }).then(() => null, e => e);
console.log(JSON.stringify({ name: L.BROWSER_NAME, message: err?.message }));
`);
  const env = { ...process.env, FIREFOX_BIN: join(dir, 'firefox-bin'), PATH: `${join(dir, 'bin')}:${process.env.PATH}` };
  delete env.BROWSER;
  const { code, out } = await runNode(script, [], env);
  assert.equal(code, 0, out);
  const res = JSON.parse(out.trim().split('\n').pop());
  assert.equal(res.name, 'chromium');
  assert.match(res.message, /^could not start headless Chromium: .*chromium exited \(code 3\) before it wrote DevToolsActivePort/);
  const argv = JSON.parse(readFileSync(record, 'utf8'));
  assert.match(argv[0], /^--user-data-dir=.*ibl-cdp-/);
  assert.deepEqual(argv.slice(1), [`${FLAG}=0`, '--no-sandbox', '--disable-gpu', '--window-size=1280,900', 'about:blank']);
  assert.equal(existsSync(marker), false, 'no Firefox was started');
});

// A stand-in Firefox: prints where "WebDriver BiDi" listens on 127.0.0.1 and answers the BiDi commands of a launch
// (session.new, browsingContext.getTree, script.evaluate, browser.close). STANDIN=dies exits 3 at once; =stubborn
// answers browser.close but does not exit (close() must kill its PID). It reports its pid, arguments and profile.
const FIREFOX_STANDIN = `#!${process.execPath}
const http = require('node:http'), crypto = require('node:crypto');
const mode = process.env.STANDIN || 'ok';
const at = process.argv.indexOf('--profile');
// Everything it reports also goes to $STANDIN_LOG (the launcher keeps only the end of the output).
const report = (line, logOnly) => { if (!logOnly) process.stderr.write(line + '\\n'); if (process.env.STANDIN_LOG) require('node:fs').appendFileSync(process.env.STANDIN_LOG, line + '\\n'); };
report('pid ' + process.pid + ' profile ' + process.argv[at + 1] + ' argv ' + JSON.stringify(process.argv.slice(2)));
let userJs = null; try { userJs = require('node:fs').readFileSync(require('node:path').join(process.argv[at + 1], 'user.js'), 'utf8'); } catch {}
report('userjs ' + JSON.stringify(userJs), true);
if (mode === 'dies') { process.stderr.write('stand-in: no display\\n'); process.exit(3); }
setInterval(() => {}, 1000);
const frame = text => { const b = Buffer.from(text); const head = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255]); return Buffer.concat([head, b]); };
const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
server.on('upgrade', (req, sock) => {
  if (req.url !== '/session') { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n');
  let buf = Buffer.alloc(0);
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      let len = buf[1] & 127, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      if (buf.length < at + 4 + len) return;
      const mask = buf.subarray(at, at + 4), data = Buffer.from(buf.subarray(at + 4, at + 4 + len)).map((x, i) => x ^ mask[i % 4]);
      const op = buf[0] & 15; buf = buf.subarray(at + 4 + len);
      if (op === 8) { sock.end(); return; }
      if (op !== 1) continue;
      const m = JSON.parse(data.toString());
      report('command ' + m.method + ' ' + JSON.stringify(m.params), true);
      const result = m.method === 'session.new' ? { sessionId: 's1', capabilities: {} }
        : m.method === 'browsingContext.getTree' ? { contexts: [{ context: 'CTX-STANDIN', url: 'about:blank', children: null }] }
        : m.method === 'script.evaluate' ? { type: 'success', realm: 'r', result: { type: 'string', value: 'evaluated ' + m.params.expression + ' in ' + m.params.target.context } }
        : {};
      sock.write(frame(JSON.stringify({ type: 'success', id: m.id, result })));
      if (m.method === 'browser.close' && mode !== 'stubborn') setTimeout(() => process.exit(0), 20);
    }
  });
});
server.listen(0, '127.0.0.1', () => process.stderr.write('WebDriver BiDi listening on ws://127.0.0.1:' + server.address().port + '\\n'));
`;
const FF_BIN = join(DIR, 'stand-in-firefox.cjs');
writeFileSync(FF_BIN, FIREFOX_STANDIN);
chmodSync(FF_BIN, 0o755);
const withEnv = async (env, fn) => {
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const alive = pid => { try { process.kill(pid, 0); } catch { return false; } try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; } };
const gone = async (pid, ms = 3000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (!alive(pid)) return true; return !alive(pid); };
const gonePath = async (p, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 25))) if (!existsSync(p)) return true; return !existsSync(p); };
const groupPids = pgid => {
  const out = new Set();
  try {
    for (const d of readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const s = readFileSync(`/proc/${d}/stat`, 'utf8');
        const i = s.lastIndexOf(') ');
        if (i < 0) continue;
        const f = s.slice(i + 2).split(' ');
        if (Number(f[2]) === pgid && f[0] !== 'Z') out.add(Number(d));
      } catch { /* exited */ }
    }
  } catch { /* non-proc */ }
  if (alive(pgid)) out.add(pgid);
  return [...out];
};
const goneGroup = async (pgid, pids, ms = 10_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 25))) {
    if (!pids.some(alive) && groupPids(pgid).length === 0) return true;
  }
  return !pids.some(alive) && groupPids(pgid).length === 0;
};
const standIn = text => { const m = /pid (\d+) profile (\S+) argv (\[.*\])/.exec(text); assert.ok(m, `the stand-in reported itself: ${text}`); return { pid: Number(m[1]), profile: m[2], argv: JSON.parse(m[3]) }; };

for (const mode of ['ok', 'stubborn']) {
  it(`a stand-in Firefox (${mode === 'ok' ? 'closes when asked' : 'ignores browser.close'}): Firefox's arguments, a private profile under the temporary directory, a CDP page; close() ends its PID and removes the profile`, async () => {
    const log = join(DIR, `standin-${mode}.log`);
    const page = await withEnv({ FIREFOX_BIN: FF_BIN, STANDIN: mode, STANDIN_LOG: log }, () => openPage({ browser: 'firefox', bin: '/not/used/chrome', args: ['--headless=new', '--no-sandbox', '--window-size=1280,900', 'about:blank'], timeoutMs: 10_000, preloadScript: preloadChoice('light') }));
    const wdPid = page.browser._watchdog?.wd?.pid;
    let info;
    try {
      const reported = readFileSync(log, 'utf8');
      info = standIn(reported);
      assert.equal(page.browser.name, 'firefox');
      assert.equal(page.browser.bin, FF_BIN, 'FIREFOX_BIN, not the bin the caller passed');
      assert.equal(info.profile, page.browser.profile);
      assert.ok(info.profile.startsWith(join(tmpdir(), 'ibl-bidi-')), info.profile);
      assert.deepEqual(info.argv, ['--headless', '--no-remote', '--profile', info.profile, `${FLAG}=0`, '--width', '1280', '--height', '900', 'about:blank#start']);
      // No preference written (Firefox's defaults: the pages are drawn as they are seen); the first tab activated once the
      // session is up, so the keys reach the page as a keyboard's do.
      assert.equal(JSON.parse(/^userjs (.*)$/m.exec(reported)[1]), null, 'no user.js');
      // The preload script is registered once for the session in a named sandbox (the stand-in launch passes preloadScript).
      assert.deepEqual(reported.split('\n').filter(l => l.startsWith('command ')).slice(0, 4),
        ['command session.new {"capabilities":{}}',
          `command script.addPreloadScript ${JSON.stringify({ functionDeclaration: `() => { ${preloadChoice('light')} }`, sandbox: 'preload' })}`,
          'command browsingContext.getTree {"maxDepth":0}', 'command browsingContext.activate {"context":"CTX-STANDIN"}']);
      assert.ok(page.ws.url.startsWith('ws://127.0.0.1:') && page.ws.url.endsWith('/session'), page.ws.url);
      assert.equal(await page.evaluate('1 + 1'), 'evaluated 1 + 1 in CTX-STANDIN');
      assert.equal(existsSync(info.profile), true);
    } finally { await page.close(); }
    assert.equal(existsSync(info.profile), false, 'the profile was removed');
    assert.ok(await gone(info.pid), `the stand-in ${info.pid} ended`);
    if (wdPid) assert.ok(await gone(wdPid), `close() disarmed the cleanup watchdog ${wdPid}`);
  });
}

it('a stand-in Firefox that exits at once: the error names it, how it ended and its output; the profile is removed', async () => {
  const err = await withEnv({ FIREFOX_BIN: FF_BIN, STANDIN: 'dies' }, () => openPage({ browser: 'firefox', timeoutMs: 10_000 }).then(() => null, e => e));
  assert.ok(err?.message.startsWith(`could not start headless Firefox: ${FF_BIN} exited (code 3) before it said where WebDriver BiDi listens`), err?.message);
  assert.match(err.message, /no display/);
  assert.equal(err.exitCode, 2);
  assert.equal(existsSync(standIn(err.message).profile), false, 'the profile was removed');
});

it('FIREFOX_BIN that does not exist: the error names it', async () => {
  await assert.rejects(withEnv({ FIREFOX_BIN: join(DIR, 'no-such-firefox') }, () => openPage({ browser: 'firefox' })), /FIREFOX_BIN=.*no-such-firefox not found/);
});

// ---- dead endpoints and killed Firefox: named error within deadline, process exits by itself ----

const LAUNCH_URL = pathToFileURL(join(HERE, '..', 'browser-launch.mjs')).href;

it('dead endpoints (silent TCP port, refused TCP port, silent-close WS): rejects with named error and Node process exits by itself', async () => {
  // 1. A TCP port that accepts and never speaks.
  const silentTcp = net.createServer(() => {});
  await new Promise(r => silentTcp.listen(0, '127.0.0.1', r));
  // 2. A TCP port that refuses connections.
  const closedSrv = net.createServer(() => {});
  await new Promise(r => closedSrv.listen(0, '127.0.0.1', r));
  const refusedPort = closedSrv.address().port;
  await new Promise(r => closedSrv.close(r));
  // 3. A WebSocket server that completes 101 Upgrade, ignores commands, and ignores Close frames.
  const silentWs = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const openSocks = new Set();
  silentWs.on('upgrade', (req, sock) => {
    openSocks.add(sock);
    sock.on('close', () => openSocks.delete(sock));
    const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
    sock.on('data', () => {});
  });
  await new Promise(r => silentWs.listen(0, '127.0.0.1', r));

  const childScript = join(DIR, 'dead-endpoint-child.mjs');
  writeFileSync(childScript, `
import { connectBidi } from ${JSON.stringify(LAUNCH_URL)};
const mode = process.argv[2], port = Number(process.argv[3]);
const url = 'ws://127.0.0.1:' + port + '/session';
const t0 = Date.now();
if (mode === 'silent-tcp' || mode === 'refused') {
  const err = await connectBidi(url, { timeoutMs: mode === 'silent-tcp' ? 350 : 5000 }).then(() => null, e => e);
  console.log(JSON.stringify({ mode, ms: Date.now() - t0, message: err?.message, code: err?.code }));
} else if (mode === 'silent-ws-close') {
  const s = await connectBidi(url, { timeoutMs: 5000, sendTimeoutMs: 25_000 });
  const pending = s.command('session.new', {});
  s.close();
  const err = await pending.then(() => null, e => e);
  console.log(JSON.stringify({ mode, ms: Date.now() - t0, message: err?.message, code: err?.code, closed: s.closed }));
}
`);
  try {
    const r1 = await runNode(childScript, ['silent-tcp', String(silentTcp.address().port)], process.env, { timeoutMs: 30_000 });
    assert.equal(r1.timedOut, false, `silent-tcp child must exit by itself: ${r1.err}`);
    assert.equal(r1.code, 0, r1.err);
    assert.equal(r1.signal, null);
    const j1 = JSON.parse(r1.out.trim().split('\n').pop());
    assert.equal(j1.code, 'DEADLINE');
    assert.match(j1.message, /^timed out after 350 ms waiting for the WebDriver BiDi socket ws:\/\/127\.0\.0\.1:\d+\/session to open$/);

    const r2 = await runNode(childScript, ['refused', String(refusedPort)], process.env, { timeoutMs: 30_000 });
    assert.equal(r2.timedOut, false, `refused child must exit by itself: ${r2.err}`);
    assert.equal(r2.code, 0, r2.err);
    assert.equal(r2.signal, null);
    const j2 = JSON.parse(r2.out.trim().split('\n').pop());
    assert.ok(j2.ms < 4000, `refused failed at once (${j2.ms} ms)`);
    assert.match(j2.message, /^could not open the WebDriver BiDi socket ws:\/\/127\.0\.0\.1:\d+\/session/);

    const r3 = await runNode(childScript, ['silent-ws-close', String(silentWs.address().port)], process.env, { timeoutMs: 30_000 });
    assert.equal(r3.timedOut, false, `silent-ws-close child must exit by itself: ${r3.err}`);
    assert.equal(r3.code, 0, r3.err);
    assert.equal(r3.signal, null);
    const j3 = JSON.parse(r3.out.trim().split('\n').pop());
    assert.equal(j3.code, 'SESSION_CLOSED');
    assert.match(j3.message, /the WebDriver BiDi connection closed while waiting for the answer to session\.new/);
    assert.ok(j3.ms < 5000, `silent-ws-close finished promptly (${j3.ms} ms)`);
  } finally {
    for (const s of openSocks) s.destroy();
    silentTcp.close();
    silentWs.close();
  }
});

it('stand-in Firefox that never speaks on BiDi, never answers session.new, or is SIGKILLed after launch: named error and Node process exits by itself', async () => {
  const deadFf = join(DIR, 'dead-standin-firefox.cjs');
  writeFileSync(deadFf, `#!${process.execPath}
const http = require('node:http'), net = require('node:net'), crypto = require('node:crypto'), { spawn } = require('node:child_process');
const mode = process.env.DEAD_MODE;
if (mode === 'silent-tcp') {
  const s = net.createServer(() => {});
  s.listen(0, '127.0.0.1', () => process.stderr.write('WebDriver BiDi listening on ws://127.0.0.1:' + s.address().port + '\\n'));
  setInterval(() => {}, 1000);
} else {
  const frame = text => { const b = Buffer.from(text); const head = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255]); return Buffer.concat([head, b]); };
  const s = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  s.on('upgrade', (req, sock) => {
    const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: ' + acc + '\\r\\n\\r\\n');
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      if (mode === 'silent-first-cmd') return; // never answers session.new and ignores Close frames
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        let len = buf[1] & 127, at = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
        if (buf.length < at + 4 + len) return;
        const mask = buf.subarray(at, at + 4), data = Buffer.from(buf.subarray(at + 4, at + 4 + len)).map((x, i) => x ^ mask[i % 4]);
        const op = buf[0] & 15; buf = buf.subarray(at + 4 + len);
        if (op !== 1) continue;
        const m = JSON.parse(data.toString());
        if (m.method === 'script.evaluate') continue; // hang until killed
        const result = m.method === 'session.new' ? { sessionId: 's1', capabilities: {} }
          : m.method === 'browsingContext.getTree' ? { contexts: [{ context: 'CTX-KILL', url: 'about:blank', children: null }] }
          : {};
        sock.write(frame(JSON.stringify({ type: 'success', id: m.id, result })));
      }
    });
  });
  let grandPid = 0;
  if (mode === 'kill-after-launch') {
    // Inherit stdio like a Firefox content/helper child for longer than the 30 s child-process timeout
    // so a pipe-ref leak cannot hide behind the grandchild exiting first.
    const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'inherit', detached: true });
    g.unref();
    grandPid = g.pid;
    if (process.env.GRAND_PID_FILE) require('node:fs').writeFileSync(process.env.GRAND_PID_FILE, String(grandPid));
  }
  s.listen(0, '127.0.0.1', () => process.stderr.write('WebDriver BiDi listening on ws://127.0.0.1:' + s.address().port + '\\n'));
  setInterval(() => {}, 1000);
}
`);
  chmodSync(deadFf, 0o755);

  const launchChild = join(DIR, 'dead-ff-launch-child.mjs');
  writeFileSync(launchChild, `
import { openPage } from ${JSON.stringify(LAUNCH_URL)};
const mode = process.argv[2];
const t0 = Date.now();
if (mode === 'silent-tcp' || mode === 'silent-first-cmd') {
  const err = await openPage({ browser: 'firefox', timeoutMs: 1200, cdpTimeoutMs: 1200 }).then(() => null, e => e);
  console.log(JSON.stringify({ mode, ms: Date.now() - t0, message: err?.message, code: err?.code }));
} else if (mode === 'kill-after-launch') {
  const page = await openPage({ browser: 'firefox', timeoutMs: 10_000, cdpTimeoutMs: 25_000 });
  const profile = page.browser.profile, pid = page.browser.pid;
  const cmdP = page.send('Runtime.evaluate', { expression: 'stuck()' });
  const evP = page.waitEvent('Page.loadEventFired', 25_000);
  const tKill = Date.now();
  process.kill(pid, 'SIGKILL');
  const [cmdErr, evErr] = await Promise.all([cmdP.then(() => null, e => e), evP.then(() => null, e => e)]);
  // Intentionally omit page.close(): the dead child must still let the process exit by itself.
  console.log(JSON.stringify({ mode, ms: Date.now() - tKill, profile, pid, cmdMsg: cmdErr?.message, cmdCode: cmdErr?.code, evMsg: evErr?.message, evCode: evErr?.code, closed: page.browser.session.closed }));
}
`);

  for (const mode of ['silent-tcp', 'silent-first-cmd']) {
    const r = await runNode(launchChild, [mode], { ...process.env, FIREFOX_BIN: deadFf, DEAD_MODE: mode }, { timeoutMs: 30_000 });
    assert.equal(r.timedOut, false, `${mode} child must exit by itself: ${r.err}`);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.signal, null);
    const j = JSON.parse(r.out.trim().split('\n').pop());
    assert.equal(j.code, 'DEADLINE');
    if (mode === 'silent-tcp') assert.match(j.message, /timed out after 1200 ms waiting for the WebDriver BiDi socket .* to open/);
    else assert.match(j.message, /timed out after 1200 ms waiting for the answer to session\.new/);
  }

  const grandFile = join(DIR, 'grand.pid');
  try {
    const tWall = Date.now();
    const r = await runNode(launchChild, ['kill-after-launch'], { ...process.env, FIREFOX_BIN: deadFf, DEAD_MODE: 'kill-after-launch', GRAND_PID_FILE: grandFile }, { timeoutMs: 30_000 });
    const wallMs = Date.now() - tWall;
    assert.equal(r.timedOut, false, `kill-after-launch child must exit by itself: ${r.err}`);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.signal, null);
    assert.ok(wallMs < 5000, `kill-after-launch child must exit promptly even while grandchild holds pipes (${wallMs} ms)`);
    const j = JSON.parse(r.out.trim().split('\n').pop());
    assert.ok(j.ms < 5000, `rejected promptly after SIGKILL (${j.ms} ms)`);
    assert.ok(['BROWSER_EXITED', 'SESSION_CLOSED', 'ECONNRESET', 'EPIPE', 'BIDI_ERROR'].includes(j.cmdCode), j.cmdCode);
    assert.ok(['BROWSER_EXITED', 'SESSION_CLOSED', 'ECONNRESET', 'EPIPE', 'BIDI_ERROR'].includes(j.evCode), j.evCode);
    assert.match(j.cmdMsg, /^(?:headless Firefox exited \(signal SIGKILL\)|the WebDriver BiDi connection (?:closed|failed \([^)]+\))) while waiting for Runtime\.evaluate of stuck\(\)$/);
    assert.match(j.evMsg, /^(?:headless Firefox exited \(signal SIGKILL\)|the WebDriver BiDi connection (?:closed|failed \([^)]+\))) while waiting for the event Page\.loadEventFired$/);
    assert.ok(await gonePath(j.profile, 5000), 'exit reaper removed the profile');
  } finally {
    if (existsSync(grandFile)) {
      const gp = Number(readFileSync(grandFile, 'utf8').trim());
      if (gp) try { process.kill(gp, 'SIGKILL'); } catch { /* gone */ }
    }
  }

  // Deterministic child-exit test: an external server keeps the BiDi socket open (even ignoring Close frames)
  // while the Firefox child exits, proving child `exit` itself fails the session with BROWSER_EXITED,
  // terminates the socket, and lets the Node process exit by itself.
  const openSocks = new Set();
  const extSrv = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const frame = text => { const b = Buffer.from(text); const head = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255]); return Buffer.concat([head, b]); };
  extSrv.on('upgrade', (req, sock) => {
    openSocks.add(sock);
    sock.on('close', () => openSocks.delete(sock));
    const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        let len = buf[1] & 127, at = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
        if (buf.length < at + 4 + len) return;
        const mask = buf.subarray(at, at + 4), data = Buffer.from(buf.subarray(at + 4, at + 4 + len)).map((x, i) => x ^ mask[i % 4]);
        const op = buf[0] & 15; buf = buf.subarray(at + 4 + len);
        if (op !== 1) continue; // ignore close frames too
        const m = JSON.parse(data.toString());
        if (m.method === 'script.evaluate') continue;
        const result = m.method === 'session.new' ? { sessionId: 's1', capabilities: {} }
          : m.method === 'browsingContext.getTree' ? { contexts: [{ context: 'CTX-EXT', url: 'about:blank', children: null }] }
          : {};
        sock.write(frame(JSON.stringify({ type: 'success', id: m.id, result })));
      }
    });
  });
  await new Promise(r => extSrv.listen(0, '127.0.0.1', r));
  const proxyFf = join(DIR, 'proxy-standin-firefox.cjs');
  writeFileSync(proxyFf, `#!${process.execPath}
process.stderr.write('WebDriver BiDi listening on ws://127.0.0.1:' + process.env.EXT_PORT + '\\n');
setInterval(() => {}, 1000);
`);
  chmodSync(proxyFf, 0o755);
  try {
    const r = await runNode(launchChild, ['kill-after-launch'], { ...process.env, FIREFOX_BIN: proxyFf, EXT_PORT: String(extSrv.address().port) }, { timeoutMs: 30_000 });
    assert.equal(r.timedOut, false, `external-socket child-exit must exit by itself: ${r.err}`);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.signal, null);
    const j = JSON.parse(r.out.trim().split('\n').pop());
    assert.ok(j.ms < 5000, `child-exit rejected promptly (${j.ms} ms)`);
    assert.equal(j.cmdCode, 'BROWSER_EXITED');
    assert.equal(j.evCode, 'BROWSER_EXITED');
    assert.match(j.cmdMsg, /^headless Firefox exited \(signal SIGKILL\) while waiting for Runtime\.evaluate of stuck\(\)$/);
    assert.match(j.evMsg, /^headless Firefox exited \(signal SIGKILL\) while waiting for the event Page\.loadEventFired$/);
    assert.equal(existsSync(j.profile), false, 'exit reaper removed the profile');
  } finally {
    for (const s of openSocks) s.destroy();
    extSrv.close();
  }
});

// ---- a real Firefox (skipped where none is installed) ----

const REAL_FIREFOX = (() => { try { return findFirefox(); } catch { return null; } })();

test('a real Firefox: a focused <button> activates by keyboard (Enter, then Space), as a person pressing the keys gets; the page has the focus', { skip: !REAL_FIREFOX && 'no Firefox (FIREFOX_BIN, firefox-esr or firefox on PATH)', timeout: 60_000 }, async () => {
  const page = await openPage({ browser: 'firefox', args: ['--no-sandbox', '--window-size=800,600', 'about:blank'] });
  try {
    // The throwaway profile, with no preference of the launcher's (no user.js): Firefox as it comes.
    assert.equal(existsSync(join(page.browser.profile, 'user.js')), false);
    await page.send('Page.enable');
    await page.send('Page.navigate', { url: 'data:text/html,<button id=b type=button>Go</button>' });
    await page.evaluate(`const b = document.getElementById('b'); window.seen = []; for (const t of ['keydown', 'keyup', 'click']) b.addEventListener(t, e => window.seen.push(t + (e.key ? ':' + e.key : ''))); true`);
    // As a test presses a button: focus, then a CDP key down and key up.
    const press = async (key, extra = {}) => {
      await page.evaluate(`document.getElementById('b').focus(); true`);
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, ...extra });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, ...extra });
      await new Promise(r => setTimeout(r, 150));
    };
    assert.deepEqual(await page.evaluate(`document.getElementById('b').focus(); ({ focus: document.hasFocus(), active: document.activeElement.id })`), { focus: true, active: 'b' }, 'the page, not the address bar or another window, has the focus');
    await press('Enter', { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await press(' ', { code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
    assert.deepEqual(await page.evaluate('window.seen'), ['keydown:Enter', 'click', 'keyup:Enter', 'keydown: ', 'keyup: ', 'click'], 'Enter clicks on key down, Space on key up');
  } finally { await page.close(); }
});

test('a real Firefox: initial and repeated viewport sizing and clearDeviceMetricsOverride succeed without hanging (Firefox 128 ESR & 159)', { skip: !REAL_FIREFOX && 'no Firefox (FIREFOX_BIN, firefox-esr or firefox on PATH)', timeout: 60_000 }, async () => {
  const page = await openPage({ browser: 'firefox', args: ['--no-sandbox', '--window-size=1280,700', 'about:blank'] });
  try {
    const initial = await page.evaluate('({ w: window.innerWidth, h: window.innerHeight })');
    for (const [width, height, deviceScaleFactor] of [[1280, 700, 1], [390, 844, 2], [1440, 1000, 1]]) {
      const r = await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: width < 700 }, { timeoutMs: 10_000 });
      assert.deepEqual(r.result, {}, `setDeviceMetricsOverride ${width}x${height}: ${JSON.stringify(r)}`);
      assert.deepEqual(await page.evaluate('({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })'), { w: width, h: height, dpr: deviceScaleFactor });
    }
    const cleared = await page.send('Emulation.clearDeviceMetricsOverride', {}, { timeoutMs: 10_000 });
    assert.deepEqual(cleared.result, {}, `clearDeviceMetricsOverride: ${JSON.stringify(cleared)}`);
    assert.deepEqual(await page.evaluate('({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })'), { ...initial, dpr: 1 });
  } finally { await page.close(); }
});

test('a real Firefox: sandboxed preload script sets localStorage before page scripts and emits no Permission denied error across about:blank and http navigations (Firefox 128 ESR & 159)', { skip: !REAL_FIREFOX && 'no Firefox (FIREFOX_BIN, firefox-esr or firefox on PATH)', timeout: 60_000 }, async () => {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><script>window.__seen = localStorage.getItem(${JSON.stringify(PRELOAD_KEY)});</script>`);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  try {
    const page = await openPage({ browser: 'firefox', args: ['--no-sandbox', '--window-size=800,600', 'about:blank'], preloadScript: preloadChoice('light') });
    try {
      const errors = [];
      page.on('Runtime.exceptionThrown', m => errors.push(exceptionText(m)));
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      for (const next of ['about:blank', 'about:blank', `${url}?a=1`, 'about:blank', 'about:blank', `${url}?a=2`]) {
        await page.send('Page.navigate', { url: next });
      }
      assert.equal(await page.evaluate('window.__seen'), JSON.stringify({ view: 'light' }));
      // An explicit page choice is preserved across subsequent navigations.
      await page.evaluate(`localStorage.setItem(${JSON.stringify(PRELOAD_KEY)}, JSON.stringify({ view: 'dark' })); true`);
      await page.send('Page.navigate', { url: 'about:blank' });
      await page.send('Page.navigate', { url: `${url}?a=3` });
      assert.equal(await page.evaluate('window.__seen'), JSON.stringify({ view: 'dark' }));
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  } finally { await new Promise(r => srv.close(r)); }
});

test('a real Firefox killed after launch: pending command and waitEvent reject at once with a named error and the child Node process exits by itself', { skip: !REAL_FIREFOX && 'no Firefox (FIREFOX_BIN, firefox-esr or firefox on PATH)', timeout: 60_000 }, async () => {
  const script = join(DIR, 'real-ff-killed-child.mjs');
  writeFileSync(script, `
import { openPage } from ${JSON.stringify(LAUNCH_URL)};
const page = await openPage({ browser: 'firefox', args: ['--no-sandbox', '--window-size=800,600', 'about:blank'], cdpTimeoutMs: 25_000 });
const profile = page.browser.profile, pid = page.browser.pid;
const cmdP = page.send('Runtime.evaluate', { expression: 'new Promise(() => {})', awaitPromise: true });
const evP = page.waitEvent('Page.loadEventFired', 25_000);
const t0 = Date.now();
process.kill(pid, 'SIGKILL');
const [cmdErr, evErr] = await Promise.all([cmdP.then(() => null, e => e), evP.then(() => null, e => e)]);
console.log(JSON.stringify({ ms: Date.now() - t0, profile, pid, cmdMsg: cmdErr?.message, cmdCode: cmdErr?.code, evMsg: evErr?.message, evCode: evErr?.code }));
`);
  const r = await runNode(script, [], process.env, { timeoutMs: 30_000 });
  assert.equal(r.timedOut, false, `real Firefox killed child must exit by itself: ${r.err}`);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.signal, null);
  const j = JSON.parse(r.out.trim().split('\n').pop());
  assert.ok(j.ms < 5000, `rejected promptly after SIGKILL (${j.ms} ms)`);
  assert.ok(Boolean(j.cmdCode) && Boolean(j.evCode), `expected named error codes: ${JSON.stringify(j)}`);
  assert.match(j.cmdMsg || '', /headless Firefox exited \(signal SIGKILL\)|WebDriver BiDi connection (?:closed|failed)/);
  assert.match(j.evMsg || '', /headless Firefox exited \(signal SIGKILL\)|WebDriver BiDi connection (?:closed|failed)/);
  assert.ok(await goneGroup(j.pid, [j.pid], 10_000), `real Firefox ${j.pid} and its process group are gone`);
  assert.ok(await gonePath(j.profile, 10_000), 'the temporary profile was removed');
});

test('a real Firefox: when the test Node process is SIGKILLed or SIGTERMed, Firefox (its process group) and its profile are removed within 10 s', { skip: !REAL_FIREFOX && 'no Firefox (FIREFOX_BIN, firefox-esr or firefox on PATH)', timeout: 60_000 }, async () => {
  const script = join(DIR, 'orphan-ff-child.mjs');
  writeFileSync(script, `
import { openPage } from ${JSON.stringify(LAUNCH_URL)};
const page = await openPage({ browser: 'firefox', args: ['--no-sandbox', '--window-size=800,600', 'about:blank'] });
process.stdout.write(JSON.stringify({ pid: page.browser.pid, profile: page.browser.profile }) + '\\n');
setInterval(() => {}, 1000);
`);
  for (const sig of ['SIGKILL', 'SIGTERM']) {
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', info = null;
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    const ended = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    try {
      await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error(`${sig} child did not become ready within 25s: ${out} | ${err}`)), 25_000);
        const onData = () => { if (/^\{"pid":\d+,/m.test(out)) { cleanup(); resolve(); } };
        const onExit = (c, s) => { cleanup(); reject(new Error(`${sig} child exited early (${c}/${s}): ${out} | ${err}`)); };
        const cleanup = () => { clearTimeout(deadline); child.stdout.off('data', onData); child.off('exit', onExit); };
        child.stdout.on('data', onData);
        child.once('exit', onExit);
      });
      info = JSON.parse(out.trim().split('\n').find(l => l.startsWith('{"pid":')));
      const pids = groupPids(info.pid);
      assert.ok(alive(info.pid), `${sig}: Firefox ${info.pid} is alive before killing test child`);
      assert.equal(existsSync(info.profile), true, `${sig}: profile ${info.profile} exists before killing test child`);
      child.kill(sig);
      const { signal } = await Promise.race([
        ended,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${sig}: test child did not exit within 5s`)), 5000)),
      ]);
      assert.equal(signal, sig);
      assert.ok(await goneGroup(info.pid, pids, 10_000), `${sig}: Firefox group [${pids.join(',')}] gone within 10s`);
      assert.ok(await gonePath(info.profile, 10_000), `${sig}: profile ${info.profile} removed within 10s`);
    } finally {
      try { child.kill('SIGKILL'); } catch { /* gone */ }
      if (info) {
        try { process.kill(-info.pid, 'SIGKILL'); } catch { /* gone */ }
        try { process.kill(info.pid, 'SIGKILL'); } catch { /* gone */ }
        if (info.profile) try { rmSync(info.profile, { recursive: true, force: true }); } catch { /* gone */ }
      }
    }
  }
});
