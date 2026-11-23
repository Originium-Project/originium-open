// Linux/macOS: runs the script as a child process and checks what is left on disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_ROOT_BYTES, makeRoot } from '../temp-root.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'temp-root.mjs');
const SCRATCH = mkdtempSync(join(tmpdir(), 'trt-'));
test.after(() => { try { chmodSync(SCRATCH, 0o700); } catch { /* gone */ } rmSync(SCRATCH, { recursive: true, force: true }); });
// The child writes its TMPDIR to a file, then runs `body`.
const childScript = (name, body) => {
  const file = join(SCRATCH, name);
  writeFileSync(file, `require('node:fs').writeFileSync(process.argv[2], process.env.TMPDIR); ${body}`);
  return file;
};
const run = (child, out, env = {}) => spawnSync(process.execPath, [SCRIPT, process.execPath, child, out], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 20_000 });

test('the child gets its own TMPDIR, and the root is gone when it ends', () => {
  const out = join(SCRATCH, 'a.txt');
  const r = run(childScript('a.cjs', "require('node:fs').writeFileSync(require('node:path').join(process.env.TMPDIR, 'x'), '1');"), out);
  assert.equal(r.status, 0, r.stderr);
  const root = readFileSync(out, 'utf8');
  assert.notEqual(root, tmpdir());
  assert.equal(existsSync(root), false, 'root removed');
});

test('the exit code of the child is the exit code of the runner', () => {
  const r = run(childScript('b.cjs', 'process.exit(7);'), join(SCRATCH, 'b.txt'));
  assert.equal(r.status, 7);
});

test('KEEP_TEMP_ROOT=1 keeps the root and says where', () => {
  const out = join(SCRATCH, 'c.txt');
  const r = run(childScript('c.cjs', ''), out, { KEEP_TEMP_ROOT: '1' });
  const root = readFileSync(out, 'utf8');
  try {
    assert.equal(existsSync(root), true);
    assert.match(r.stderr, /KEEP_TEMP_ROOT=1: temp root kept at /);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a root with a mode 000 folder inside is still removed', () => {
  const body = "const p = require('node:path').join(process.env.TMPDIR, 'locked'); require('node:fs').mkdirSync(p); require('node:fs').writeFileSync(p + '/f', 'x'); require('node:fs').chmodSync(p, 0);";
  const out = join(SCRATCH, 'd.txt');
  const r = run(childScript('d.cjs', body), out);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(readFileSync(out, 'utf8')), false);
});

test('a long TMPDIR gets a short root (at most 15 bytes) on disk', () => {
  const longBase = join(SCRATCH, 'a-rather-long-base-directory-name');
  mkdirSync(longBase);
  const out = join(SCRATCH, 'e.txt');
  const r = run(childScript('e.cjs', ''), out, { TMPDIR: longBase });
  assert.equal(r.status, 0, r.stderr);
  const root = readFileSync(out, 'utf8');
  assert.ok(Buffer.byteLength(root) <= MAX_ROOT_BYTES || !root.startsWith('/var/tmp/'), `root ${root}`);
  assert.equal(existsSync(root), false);
});

test('makeRoot: a short base is used; a long base falls to the short folder; a missing short folder falls back to the base', () => {
  const shortBase = '/tmp'; // '/tmp/oXXXXXX' is 12 bytes
  const longBase = join(SCRATCH, 'another-long-base-directory');
  mkdirSync(longBase);
  const shortDir = join(SCRATCH, 's');
  mkdirSync(shortDir);
  const roots = [];
  try {
    roots.push(makeRoot({ base: shortBase }));
    assert.equal(roots[0].startsWith('/tmp/o'), true);
    roots.push(makeRoot({ base: longBase, short: shortDir }));
    assert.equal(roots[1].startsWith(shortDir + '/'), true);
    roots.push(makeRoot({ base: longBase, short: join(SCRATCH, 'missing') }));
    assert.equal(roots[2].startsWith(longBase + '/o'), true);
  } finally { for (const r of roots) rmSync(r, { recursive: true, force: true }); }
});

test('a SIGTERM to the runner is forwarded, the child ends, the root is removed, the status is 128 + 15', async () => {
  const out = join(SCRATCH, 'f.txt');
  const child = childScript('f.cjs', 'setInterval(() => {}, 1000);');
  const proc = spawn(process.execPath, [SCRIPT, process.execPath, child, out], { stdio: 'ignore' });
  const ended = new Promise(r => proc.once('exit', (code, signal) => r({ code, signal })));
  for (let i = 0; i < 200 && !existsSync(out); i++) await new Promise(r => setTimeout(r, 25));
  assert.ok(existsSync(out), 'the child started');
  const root = readFileSync(out, 'utf8');
  proc.kill('SIGTERM');
  const { code } = await ended;
  assert.equal(code, 143);
  assert.equal(existsSync(root), false);
});

test('no command: usage and status 2', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: node temp-root\.mjs/);
});
