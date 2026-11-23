#!/usr/bin/env node
/**
 * Runs a command with its own temp root as TMPDIR and removes the root when the command ends (any exit, or a signal to
 * this process), so a test run leaves nothing behind (/tmp can be RAM). KEEP_TEMP_ROOT=1 keeps the root.
 *
 *   node temp-root.mjs <command> [args...]
 *
 * The root is made in the caller's TMPDIR only when that keeps it at most 15 bytes, else as /var/tmp/XXXXXX (15 bytes,
 * on disk: a long TMPDIR is usually set to keep test data out of a RAM /tmp), so a long TMPDIR cannot push Unix socket
 * paths over their limit (sun_path is about 108 bytes); when /var/tmp cannot take it, the caller's TMPDIR is used as
 * before, long or not.
 * The exit status is the child's code, else 128 + the signal number. A first signal is forwarded as is; a second one
 * while the child still runs kills it, so this process can always end and clean up.
 */
import { spawn } from 'node:child_process';
import { chmodSync, lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Make every directory under dir owner-accessible (never following symlinks), so a test's mode 000 folder can be removed.
function unlock(dir) {
  let entries;
  try { chmodSync(dir, 0o700); entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const path = join(dir, name);
    try { if (lstatSync(path).isDirectory()) unlock(path); } catch { /* gone or unreadable: rm reports it */ }
  }
}

export function removeRoot(root) {
  try { rmSync(root, { recursive: true, force: true }); return; } catch { /* retry after unlocking */ }
  unlock(root);
  try { rmSync(root, { recursive: true, force: true }); } catch (err) { console.error(`could not remove temp root ${root}: ${err.message}`); }
}

// The caller's TMPDIR when a root there (join(base, 'oXXXXXX')) fits in 15 bytes; else a bare /var/tmp/XXXXXX, which is 15
// bytes and on disk, never the RAM /tmp; else, when that is missing or refuses the folder, the caller's TMPDIR as
// before: a long root is better than a runner that cannot start.
export const MAX_ROOT_BYTES = 15;
export function makeRoot({ base = tmpdir(), short = '/var/tmp' } = {}) {
  if (Buffer.byteLength(join(base, 'oXXXXXX')) > MAX_ROOT_BYTES) { try { return mkdtempSync(`${short}/`); } catch { /* fall back */ } }
  return mkdtempSync(join(base, 'o'));
}

export function runWithTempRoot(command, args, env = process.env) {
  const root = makeRoot();
  const keep = env.KEEP_TEMP_ROOT === '1';
  if (keep) console.error(`KEEP_TEMP_ROOT=1: temp root kept at ${root}`);
  const cleanup = () => { if (!keep) removeRoot(root); };
  const child = spawn(command, args, { stdio: 'inherit', env: { ...env, TMPDIR: root } });
  let signalled = false;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { child.kill(signalled ? 'SIGKILL' : sig); signalled = true; });
  child.on('error', err => { console.error(err.message); cleanup(); process.exit(1); });
  child.on('close', (code, signal) => {
    cleanup();
    process.exit(code ?? (signal ? 128 + (constants.signals[signal] ?? 1) : 1));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) { console.error('usage: node temp-root.mjs <command> [args...]'); process.exit(2); }
  runWithTempRoot(command, args);
}
