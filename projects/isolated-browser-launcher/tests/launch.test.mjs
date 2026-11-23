// The browser launcher (browser-launch.mjs) on its failure paths, with stand-in "browsers" (small Node scripts) instead
// of Chromium, so it runs everywhere: a browser that never writes its port file is given up at the deadline and its
// profile removed; one that exits at once is named, with its stderr; a page list that stays empty, a DevTools command
// that is never answered, a socket that closes, all end with an error saying what was awaited; close() and a process
// exit through `unreadExit` (or a thrown error, or SIGTERM) kill the browser and its children and remove the profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connectCdp, launchBrowser as launchAny, openPage as openAny, withDeadline } from '../browser-launch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Written in parts so that no line of this file passes the flag itself.
const FLAG = ['--remote', 'debugging', 'port'].join('-');
const DIR = mkdtempSync(join(tmpdir(), 'ibl-standin-'));
test.after(() => rmSync(DIR, { recursive: true, force: true }));
// A launcher that waits for ever fails its test instead of hanging the run.
const it = (name, fn) => test(name, { timeout: 30_000 }, fn);

// A stand-in browser: STANDIN=never writes no port file; =dies exits 3 at once; =ok writes DevToolsActivePort for a
// small DevTools server on 127.0.0.1 (a page list, and a WebSocket that answers every command but Never.answer, and
// closes on Close.socket), after starting a grandchild that must die with it. It reports its pids on stderr.
const STANDIN = `#!${process.execPath}
const { spawn } = require('node:child_process');
const fs = require('node:fs'), http = require('node:http'), crypto = require('node:crypto'), path = require('node:path');
const profile = (process.argv.find(a => a.startsWith('--user-data-dir=')) || '').slice(16);
const mode = process.env.STANDIN || 'ok';
process.stderr.write('stand-in started with ' + process.argv.slice(2).join(' ') + '\\n');
if (mode === 'dies') { process.stderr.write('stand-in: cannot open display :99\\n'); process.exit(3); }
const grand = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
process.stderr.write('pids ' + process.pid + ' ' + grand.pid + ' profile ' + profile + '\\n');
setInterval(() => {}, 1000);
if (mode === 'never') return;
const frame = text => { const b = Buffer.from(text); const head = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255]); return Buffer.concat([head, b]); };
const server = http.createServer((req, res) => {
  const pages = process.env.STANDIN_NO_PAGES ? [] : [{ id: 'PAGE1', type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://other-host.invalid:9222/devtools/page/PAGE1' }];
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(req.url.startsWith('/json/new') ? { id: 'PAGE2', type: 'page' } : pages));
});
server.on('upgrade', (req, sock) => {
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
      if (m.method === 'Never.answer') continue;
      if (m.method === 'Close.socket') { sock.destroy(); return; }
      if (m.method === 'Emit.event') sock.write(frame(JSON.stringify({ method: 'Stand.in', params: { n: 1 } })));
      const result = m.method === 'Runtime.evaluate' ? { result: { type: 'string', value: 'evaluated ' + m.params.expression } } : {};
      sock.write(frame(JSON.stringify({ id: m.id, result })));
    }
  });
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), server.address().port + '\\n/devtools/browser/stand-in\\n'));
`;
const BIN = join(DIR, 'stand-in-browser.cjs');
// The stand-in is a Chromium: pinned, so these run the same under BROWSER=firefox (npm run test:firefox).
const launchBrowser = (opts = {}) => launchAny({ browser: 'chromium', ...opts });
const openPage = (opts = {}) => openAny({ browser: 'chromium', ...opts });
writeFileSync(BIN, STANDIN);
chmodSync(BIN, 0o755);

const withEnv = async (env, fn) => {
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
/** A pid that is gone (or a zombie no one reaped yet). */
const alive = pid => {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; }
};
const gone = async (pids, ms = 3000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) if (!pids.some(alive)) return true;
  return !pids.some(alive);
};
const pidsOf = text => { const m = /pids (\d+) (\d+) profile (\S+)/.exec(text); assert.ok(m, `the stand-in reported its pids: ${text}`); return { pids: [Number(m[1]), Number(m[2])], profile: m[3] }; };

it('a browser that never writes DevToolsActivePort: given up at the deadline, named, killed with its children, profile removed', async () => {
  const t0 = Date.now();
  const err = await withEnv({ STANDIN: 'never' }, () => launchBrowser({ bin: BIN, args: ['about:blank'], timeoutMs: 700 }).then(() => null, e => e));
  assert.ok(err, 'the launch failed');
  assert.ok(Date.now() - t0 >= 650 && Date.now() - t0 < 6000, `gave up at the deadline (${Date.now() - t0} ms)`);
  assert.match(err.message, /^could not start headless Chromium: /);
  assert.ok(err.message.includes(`${BIN} wrote no DevToolsActivePort within 700 ms`), err.message);
  assert.match(err.message, new RegExp(`stderr: [^]*stand-in started with --user-data-dir=\\S+ ${FLAG}=0 about:blank`), 'port 0 and a private profile, and the stderr tail');
  assert.equal(err.exitCode, 2);
  const { pids, profile } = pidsOf(err.message);
  assert.ok(profile.startsWith(tmpdir()), profile);
  assert.equal(existsSync(profile), false, 'the profile was removed');
  assert.ok(await gone(pids), `the stand-in and its child were killed: ${pids}`);
});

it('a browser that exits at once: the error names it, how it ended and its stderr, without waiting for the deadline', async () => {
  const t0 = Date.now();
  const err = await withEnv({ STANDIN: 'dies' }, () => launchBrowser({ bin: BIN, timeoutMs: 20_000 }).then(() => null, e => e));
  assert.ok(err && Date.now() - t0 < 5000, `failed at once (${Date.now() - t0} ms)`);
  assert.ok(err.message.startsWith(`could not start headless Chromium: ${BIN} exited (code 3) before it wrote DevToolsActivePort`), err.message);
  assert.match(err.message, /stderr: .*cannot open display :99/s);
  const profile = /--user-data-dir=(\S+)/.exec(err.message)[1];
  assert.equal(existsSync(profile), false, 'the profile was removed');
});

it('a binary that does not exist: the error names it', async () => {
  const missing = join(DIR, 'no-such-browser');
  const err = await launchBrowser({ bin: missing, timeoutMs: 5000 }).then(() => null, e => e);
  assert.ok(err?.message.startsWith(`could not start headless Chromium: ${missing} could not be run (ENOENT)`), err?.message);
});

it('the port comes from the profile; DevTools goes to 127.0.0.1:<that port> only; close() kills the group and removes the profile', async () => {
  const b = await launchBrowser({ bin: BIN, args: ['about:blank'], timeoutMs: 10_000 });
  try {
    const { pids, profile } = pidsOf(b.stderrTail());
    assert.equal(profile, b.profile);
    assert.equal(Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]), b.port);
    // The page list names another host; the connection still goes to 127.0.0.1:<port>.
    const page = await b.openPage();
    assert.equal(page.ws.url, `ws://127.0.0.1:${b.port}/devtools/page/PAGE1`);
    assert.equal(await page.evaluate('1 + 1'), 'evaluated 1 + 1');
    const ev = page.waitEvent('Stand.in', 2000);
    await page.send('Emit.event');
    assert.deepEqual((await ev).params, { n: 1 });
    const tab = await b.connect(await b.newPage());
    assert.equal(tab.ws.url, `ws://127.0.0.1:${b.port}/devtools/page/PAGE2`);
    await b.close();
    assert.equal(existsSync(profile), false, 'the profile was removed');
    assert.ok(await gone(pids), `the stand-in and its child were killed: ${pids}`);
  } finally { await b.close(); }
});

it('DevTools waits have deadlines that say what they waited for; a closed connection fails what is still waiting', async () => {
  const page = await openPage({ bin: BIN, timeoutMs: 10_000 });
  try {
    await assert.rejects(page.send('Never.answer', {}, { timeoutMs: 300 }), /^Error: timed out after 300 ms waiting for the answer to Never\.answer$/);
    await assert.rejects(page.waitEvent('Page.loadEventFired', 300), /timed out after 300 ms waiting for the event Page\.loadEventFired/);
    const waiting = page.send('Never.answer', {}, { timeoutMs: 20_000 });
    const t0 = Date.now();
    page.send('Close.socket').catch(() => {});
    await assert.rejects(waiting, /the DevTools connection closed while waiting for the answer to Never\.answer/);
    assert.ok(Date.now() - t0 < 5000, 'failed when the socket closed, not at the deadline');
    await assert.rejects(page.evaluate('document.title'), /the DevTools connection closed before Runtime\.evaluate of document\.title/);
  } finally { await page.close(); }
});

it('a page list that stays empty: openPage gives up at the deadline and closes the browser', async () => {
  const err = await withEnv({ STANDIN_NO_PAGES: '1' }, () => openPage({ bin: BIN, timeoutMs: 600 }).then(() => null, e => e));
  assert.match(err?.message || '', /^could not start headless Chromium: .* opened no page on 127\.0\.0\.1:\d+ within 600 ms/);
  assert.equal(err.exitCode, 2);
});

it('a socket that never opens, and a host other than 127.0.0.1, are refused with what was asked for', async () => {
  await assert.rejects(connectCdp('ws://localhost:9222/devtools/page/X'), /DevTools connections go to 127\.0\.0\.1 only, not localhost:9222/);
  // A port that accepts and then says nothing: the upgrade never comes.
  const silent = net.createServer(() => {});
  await new Promise(r => silent.listen(0, '127.0.0.1', r));
  try {
    const url = `ws://127.0.0.1:${silent.address().port}/devtools/page/X`;
    await assert.rejects(connectCdp(url, { timeoutMs: 400 }), new RegExp(`timed out after 400 ms waiting for the DevTools socket ${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} to open`));
  } finally { silent.close(); }
  await assert.rejects(withDeadline(new Promise(() => {}), 50, 'nothing'), /^Error: timed out after 50 ms waiting for nothing$/);
});

it('launchBrowser refuses a port or profile of the caller\'s own', async () => {
  const itself = new RegExp(`adds ${FLAG}=0 and --user-data-dir itself`);
  await assert.rejects(launchBrowser({ bin: BIN, args: [`${FLAG}=9222`] }), itself);
  await assert.rejects(launchBrowser({ bin: BIN, args: ['--user-data-dir=/tmp/x'] }), itself);
});

// A script that leaves its browser open and ends through unreadExit (exit 2), a thrown error, SIGTERM, or SIGKILL.
const SCRIPT = `
import { launchBrowser } from ${JSON.stringify(pathToFileURL(join(HERE, '..', 'browser-launch.mjs')).href)};
// Ends a run that could not read a page ("UNREAD: <why>", exit 2), as a check script would.
const unreadExit = err => { console.log('UNREAD: ' + String(err?.message || err).split('\\n')[0]); process.exit(2); };
const b = await launchBrowser({ browser: 'chromium', bin: ${JSON.stringify(BIN)}, timeoutMs: 10_000 });
console.log('STARTED ' + b.stderrTail().split('\\n').find(l => l.startsWith('pids ')));
const how = process.argv[2];
if (how === 'unread') unreadExit('the stand-in page was not read');
if (how === 'throw') throw new Error('a check threw');
setInterval(() => {}, 1000);
`;
const SCRIPT_FILE = join(DIR, 'leaves-browser.mjs');
writeFileSync(SCRIPT_FILE, SCRIPT);

for (const how of ['unread', 'throw', 'SIGTERM', 'SIGKILL']) {
  it(`a script that ends through ${how === 'unread' ? 'unreadExit (exit 2)' : how === 'throw' ? 'a thrown error' : how} with its browser open: the browser and its child are killed, the profile removed`, async () => {
    const child = spawn(process.execPath, [SCRIPT_FILE, how], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', errText = '', pids = [], profile = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { errText += d; });
    const ended = new Promise(r => child.once('exit', (code, signal) => r({ code, signal })));
    try {
      await withDeadline(new Promise(r => { const tick = () => (/STARTED pids/.test(out) ? r() : setTimeout(tick, 20)); tick(); }), 10_000, 'the script to start its browser');
      ({ pids, profile } = pidsOf(out));
      if (how === 'SIGTERM' || how === 'SIGKILL') child.kill(how);
      const { code, signal } = await withDeadline(ended, 10_000, 'the script to end');
      if (how === 'unread') { assert.equal(code, 2); assert.match(out, /^UNREAD: the stand-in page was not read$/m); }
      if (how === 'throw') { assert.equal(code, 1); assert.match(errText, /a check threw/); }
      if (how === 'SIGTERM' || how === 'SIGKILL') assert.equal(signal, how, 'the signal still ends the script');
      assert.ok(await gone(pids, 10_000), `the stand-in and its child were killed: ${pids}`);
      for (let end = Date.now() + 5000; existsSync(profile) && Date.now() < end; await new Promise(r => setTimeout(r, 25)));
      assert.equal(existsSync(profile), false, 'the profile was removed');
    } finally {
      for (const p of pids) {
        try { process.kill(-p, 'SIGKILL'); } catch { /* gone */ }
        try { process.kill(p, 'SIGKILL'); } catch { /* gone */ }
      }
      try { child.kill('SIGKILL'); } catch { /* gone */ }
      if (profile) try { rmSync(profile, { recursive: true, force: true }); } catch { /* gone */ }
    }
  });
}
