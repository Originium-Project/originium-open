// Linux only: the hook uses flock and /proc; these tests skip when either is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, rmSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../pre-push', import.meta.url));
const checkIdentity = fileURLToPath(new URL('../check-identity.sh', import.meta.url));
const hasFlock = hasCommand('flock');
const hasProcFdinfo = canRead('/proc/self/fdinfo');
const unsupported = !hasFlock || !hasProcFdinfo ? 'flock(1) or /proc/self/fdinfo is unavailable' : false;

function hasCommand(name) {
  try {
    const run = spawnSync(name, ['--version'], { stdio: 'ignore', timeout: 2000 });
    return run.status === 0;
  } catch { return false; }
}

function canRead(path) {
  try { accessSync(path, constants.R_OK); return true; } catch { return false; }
}

function baseEnv(home) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value;
  return { ...env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' };
}

function git(cwd, args, env) {
  const run = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout: 15000 });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed (${run.status}): ${run.stderr}`);
  return run.stdout;
}

async function fixture(t, { delay = 0 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'push-guard-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'), repo = join(root, 'repo'), remote = join(root, 'remote.git'), hooks = join(root, 'hooks');
  const lockPath = join(root, 'cache', 'suite.lock');
  await mkdir(home, { recursive: true });
  const env = baseEnv(home);
  env.npm_config_cache = join(root, 'npm-cache');
  env.SUITE_DELAY = String(delay);
  git(root, ['init', '--bare', '--quiet', remote], env);
  git(root, ['init', '--quiet', repo], env);
  git(repo, ['config', 'user.name', 'Prepush Test'], env);
  git(repo, ['config', 'user.email', 'prepush@example.com'], env);
  // Fixture commits use a role address so the identity guard allows them.
  const role = ['-c', 'user.name=Prepush Test', '-c', 'user.email=agent@users.noreply.local'];
  git(repo, ['config', 'commit.gpgsign', 'false'], env);
  git(repo, ['config', 'core.hooksPath', hooks], env);
  await mkdir(hooks, { recursive: true });
  await copyFile(hook, join(hooks, 'pre-push'));
  await copyFile(checkIdentity, join(hooks, 'check-identity.sh'));
  await chmod(join(hooks, 'pre-push'), 0o755);
  await chmod(join(hooks, 'check-identity.sh'), 0o755);
  // SUITE_DELAY makes the fake suite slow on purpose without blocking it on anything.
  const testScript = 'echo started > suite-started.txt; sleep "${SUITE_DELAY:-0}"; echo ran > test-ran.txt; flock -n "$PUSH_GUARD_SUITE_LOCK" true; [ $? -eq 1 ] && echo held > lock-state.txt || echo free > lock-state.txt; ' +
    'lk=$(realpath "$PUSH_GUARD_SUITE_LOCK"); s=closed; for d in /proc/$PPID/fd/* /proc/$$/fd/*; do [ "$(readlink "$d")" = "$lk" ] && s=inherited; done; echo $s > lock-fd.txt';
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'pre-push-lock-fixture', private: true, scripts: { test: testScript } }, null, 2));
  await writeFile(join(repo, 'README.md'), 'fixture\n');
  git(repo, ['add', '-A'], env);
  git(repo, [...role, 'commit', '--quiet', '-m', 'fixture'], env);
  git(repo, ['branch', '-M', 'main'], env);
  git(repo, ['remote', 'add', 'origin', remote], env);
  return { root, repo, env, lock: lockPath, ran: join(repo, 'test-ran.txt'), started: join(repo, 'suite-started.txt'), state: join(repo, 'lock-state.txt'), lockFd: join(repo, 'lock-fd.txt') };
}

function run(command, args, { cwd, env, timeout = 15000, abortOn } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '', stderr = '', timedOut = false, blocked = false, settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, timeout);
    const finish = result => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve({ ...result, stdout, stderr, timedOut, blocked, duration: Date.now() - started });
    };
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => {
      stderr += chunk;
      // The hook says "another suite holds" right before it blocks on the lock: that is the deadlock state itself.
      if (abortOn && !blocked && abortOn.test(stderr)) { blocked = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    });
    child.on('error', error => finish({ error, code: null, signal: null }));
    child.on('exit', (code, signal) => finish({ code, signal }));
  });
}

async function waitForFile(path, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function stop(child) {
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  await new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(resolve, 2000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

// A run is judged by what the hook does, not by how long it takes: the child bound is only a backstop for a hang
// (quiet run ~0.25 s; the test timeout is 120 s), and a nested push counts as deadlocked when it reports waiting on the lock.
const options = { skip: unsupported, timeout: 120000 };
const backstop = 100000;
const waiting = /another suite holds/;

test('pre-push holds the suite lock while npm test runs', options, async t => {
  const f = await fixture(t);
  const result = await run('git', ['push', 'origin', 'main'], {
    cwd: f.repo, env: { ...f.env, PUSH_GUARD_SUITE_LOCK: f.lock, PUSH_GUARD_SUITE_LOCK_WAIT: '30' }, timeout: backstop
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readFile(f.ran, 'utf8')).trim(), 'ran');
  assert.equal((await readFile(f.state, 'utf8')).trim(), 'held');
  assert.equal((await readFile(f.lockFd, 'utf8')).trim(), 'closed', 'neither npm nor the test shell has the lock file open');
  assert.equal(existsSync(f.lock), true, 'the hook creates the lock directory and file');
});

test('pre-push times out without running the suite when another process holds the lock', options, async t => {
  const f = await fixture(t);
  await mkdir(dirname(f.lock), { recursive: true });
  const ready = join(f.root, 'ready');
  const holderScript = join(f.root, 'hold.sh');
  await writeFile(holderScript, '#!/usr/bin/env bash\n: > "$1"\nexec sleep 30\n');
  await chmod(holderScript, 0o755);
  const holder = spawn('flock', [f.lock, 'bash', holderScript, ready], { stdio: 'ignore', detached: true });
  t.after(() => stop(holder));
  await waitForFile(ready);
  const result = await run('git', ['push', 'origin', 'main'], {
    cwd: f.repo, env: { ...f.env, PUSH_GUARD_SUITE_LOCK: f.lock, PUSH_GUARD_SUITE_LOCK_WAIT: '2' }, timeout: 15000
  });
  assert.equal(existsSync(f.ran), false, 'npm test must not run outside the lock');
  assert.notEqual(result.code, 0, 'the push must fail when the lock is not acquired');
  assert.match(result.stderr, /another suite holds .*; waiting up to 2s/, 'a busy lock says so before the wait');
  assert.match(result.stderr, /suite lock .* was not acquired within 2s/);
  await stop(holder);
});

test('pre-push waits when an ancestor holds the lock only shared', options, async t => {
  const f = await fixture(t);
  await mkdir(dirname(f.lock), { recursive: true });
  // flock -s is not the suite protocol: a shared hold excludes no other suite, so it never counts as holding the lock.
  const result = await run('bash', ['-c', 'exec 7>>"$1"; flock -s 7 || exit 3; git push origin main', 'holder', f.lock], {
    cwd: f.repo, env: { ...f.env, PUSH_GUARD_SUITE_LOCK: f.lock, PUSH_GUARD_SUITE_LOCK_WAIT: '2' }, timeout: 15000
  });
  assert.equal(existsSync(f.ran), false, 'the suite must not run under a shared hold');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /suite lock .* was not acquired within 2s/);
});

test('pre-push runs directly when an ancestor already holds the lock', options, async t => {
  const f = await fixture(t);
  await mkdir(dirname(f.lock), { recursive: true });
  const result = await run('flock', [f.lock, 'git', 'push', 'origin', 'main'], {
    cwd: f.repo, env: { ...f.env, PUSH_GUARD_SUITE_LOCK: f.lock, PUSH_GUARD_SUITE_LOCK_WAIT: '60' }, timeout: backstop, abortOn: waiting
  });
  assert.equal(result.blocked, false, `a nested flock must not deadlock: ${result.stderr}`);
  assert.equal(result.timedOut, false, 'the push hung');
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readFile(f.ran, 'utf8')).trim(), 'ran');
  assert.equal((await readFile(f.state, 'utf8')).trim(), 'held');
  assert.equal((await readFile(f.lockFd, 'utf8')).trim(), 'closed', 'neither npm nor the test shell has the lock file open');
});

test('pre-push runs directly when an ancestor holds the lock through an inherited descriptor', options, async t => {
  const f = await fixture(t);
  await mkdir(dirname(f.lock), { recursive: true });
  const result = await run('bash', ['-c', 'exec 8>>"$1"; flock 8 || exit 3; git push origin main', 'holder', f.lock], {
    cwd: f.repo, env: { ...f.env, PUSH_GUARD_SUITE_LOCK: f.lock, PUSH_GUARD_SUITE_LOCK_WAIT: '60' }, timeout: backstop, abortOn: waiting
  });
  assert.equal(result.blocked, false, `a lock held through a descriptor must not deadlock the nested push: ${result.stderr}`);
  assert.equal(result.timedOut, false, 'the push hung');
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readFile(f.ran, 'utf8')).trim(), 'ran');
  assert.equal((await readFile(f.state, 'utf8')).trim(), 'held');
  assert.equal((await readFile(f.lockFd, 'utf8')).trim(), 'closed', 'neither npm nor the test shell has the lock file open');
});

test('pre-push skips tests without taking the lock when PUSH_GUARD_SKIP_TESTS=1', options, async t => {
  const f = await fixture(t);
  const result = await run('git', ['push', 'origin', 'main'], {
    cwd: f.repo, env: { ...f.env, PUSH_GUARD_SUITE_LOCK: f.lock, PUSH_GUARD_SKIP_TESTS: '1' }, timeout: 15000
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(existsSync(f.ran), false);
  assert.equal(existsSync(f.lock), false, 'no lock is taken when tests are skipped');
  assert.equal(existsSync(dirname(f.lock)), false, 'the lock directory is not created when tests are skipped');
});


test('pre-push waits when an ancestor has an unlocked descriptor', options, async t => {
  const f = await fixture(t);
  await mkdir(dirname(f.lock), { recursive: true });
  const ready = join(f.root, 'ready');
  const holder = spawn('flock', [f.lock, 'bash', '-c', ': > "$1"; exec sleep 30', 'holder', ready], { stdio: 'ignore', detached: true });
  t.after(() => stop(holder));
  await waitForFile(ready);
  const result = await run('bash', ['-c', 'exec 7>>"$1"; git push origin main', 'parent', f.lock], {
    cwd: f.repo, env: { ...f.env, PUSH_GUARD_SUITE_LOCK: f.lock, PUSH_GUARD_SUITE_LOCK_WAIT: '2' }, timeout: 10000
  });
  assert.equal(result.timedOut, false);
  assert.notEqual(result.code, 0, 'the push must fail when the lock is not acquired');
  assert.match(result.stderr, /suite lock .* was not acquired within 2s/);
  assert.equal(existsSync(f.ran), false, 'npm test must not run outside the lock');
});

test('pre-push waits when only a child retains the locked descriptor', options, async t => {
  const f = await fixture(t);
  await mkdir(dirname(f.lock), { recursive: true });
  // The process that takes flock must remain on the push chain for its recorded PID to become stale.
  const script = 'import fcntl, os, sys, time; fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o666); os.dup2(fd, 7, inheritable=True); fcntl.flock(7, fcntl.LOCK_EX); child = os.fork(); ' +
    '(time.sleep(30), os._exit(0)) if child == 0 else os.execlp("bash", "bash", "-c", sys.argv[2], "parent", str(child))';
  const shell = 'exec 7>&-; git push origin main; rc=$?; kill "$1" 2>/dev/null; wait "$1" 2>/dev/null; exit "$rc"';
  const result = await run('python3', ['-c', script, f.lock, shell], {
    cwd: f.repo, env: { ...f.env, PUSH_GUARD_SUITE_LOCK: f.lock, PUSH_GUARD_SUITE_LOCK_WAIT: '2' }, timeout: 10000
  });
  assert.equal(result.timedOut, false);
  assert.notEqual(result.code, 0, 'the push must fail when the lock is not acquired');
  assert.match(result.stderr, /suite lock .* was not acquired within 2s/);
  assert.equal(existsSync(f.ran), false, 'npm test must not run outside the lock');
});

test('pre-push runs tests without a lock path when HOME is unset', options, async t => {
  const f = await fixture(t);
  const env = { ...f.env };
  delete env.HOME;
  delete env.PUSH_GUARD_SUITE_LOCK;
  const result = await run('git', ['push', 'origin', 'main'], { cwd: f.repo, env, timeout: backstop });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /no suite lock path/);
  assert.equal((await readFile(f.ran, 'utf8')).trim(), 'ran');
});

test('pre-push runs directly under an ancestor lock while the suite is slow', options, async t => {
  // 12 s is past the old fixed 10 s child bound; the hook is slow here, not deadlocked.
  const f = await fixture(t, { delay: 12 });
  await mkdir(dirname(f.lock), { recursive: true });
  const result = await run('flock', [f.lock, 'git', 'push', 'origin', 'main'], {
    cwd: f.repo, env: { ...f.env, PUSH_GUARD_SUITE_LOCK: f.lock, PUSH_GUARD_SUITE_LOCK_WAIT: '60' }, timeout: backstop, abortOn: waiting
  });
  assert.equal(result.blocked, false, `a nested flock must not deadlock: ${result.stderr}`);
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readFile(f.started, 'utf8')).trim(), 'started');
  assert.equal((await readFile(f.ran, 'utf8')).trim(), 'ran');
});

test('a lock held by an unrelated process is reported as blocked, not as a slow hook', options, async t => {
  const f = await fixture(t);
  await mkdir(dirname(f.lock), { recursive: true });
  const ready = join(f.root, 'ready');
  const holder = spawn('flock', [f.lock, 'bash', '-c', ': > "$1"; exec sleep 60', 'holder', ready], { stdio: 'ignore', detached: true });
  t.after(() => stop(holder));
  await waitForFile(ready);
  const result = await run('git', ['push', 'origin', 'main'], {
    cwd: f.repo, env: { ...f.env, PUSH_GUARD_SUITE_LOCK: f.lock, PUSH_GUARD_SUITE_LOCK_WAIT: '60' }, timeout: backstop, abortOn: waiting
  });
  assert.equal(result.blocked, true, 'the detector must flag a push that waits on a lock nobody on its chain holds');
  assert.equal(existsSync(f.started), false, 'the suite must not run while blocked');
});
