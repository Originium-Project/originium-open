// Linux only: the hook uses flock and /proc; these tests skip when either is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, rmSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../pre-push', import.meta.url));
const checkIdentity = fileURLToPath(new URL('../check-identity.sh', import.meta.url));
const unsupported = !commandWorks('flock') || !canRead('/proc/self/fdinfo') ? 'flock(1) or /proc/self/fdinfo is unavailable' : false;

function commandWorks(name) {
  try { return spawnSync(name, ['--version'], { stdio: 'ignore', timeout: 2000 }).status === 0; } catch { return false; }
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

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'push-guard-head-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'), repo = join(root, 'repo'), remote = join(root, 'remote.git'), hooks = join(root, 'hooks');
  await mkdir(home, { recursive: true });
  const env = baseEnv(home);
  env.npm_config_cache = join(root, 'npm-cache');
  env.SUITE_DELAY = '0'; // only a test that asks for a slow suite gets one, never an inherited value
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
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'pre-push-head-fixture', private: true, scripts: { test: 'sleep "${SUITE_DELAY:-0}"; echo ran > test-ran.txt' } }, null, 2));
  await writeFile(join(repo, 'README.md'), 'fixture\n');
  git(repo, ['add', '-A'], env);
  git(repo, [...role, 'commit', '--quiet', '-m', 'first'], env);
  git(repo, ['branch', '-M', 'main'], env);
  git(repo, ['branch', 'old'], env);
  await writeFile(join(repo, 'second.txt'), 'second\n');
  git(repo, ['add', '-A'], env);
  git(repo, [...role, 'commit', '--quiet', '-m', 'second'], env);
  git(repo, ['remote', 'add', 'origin', remote], env);
  return {
    root, repo, remote, env,
    lock: join(root, 'cache', 'suite.lock'),
    ran: join(repo, 'test-ran.txt'),
    oldSha: git(repo, ['rev-parse', 'old'], env).trim(),
    headSha: git(repo, ['rev-parse', 'HEAD'], env).trim()
  };
}

function run(command, args, { cwd, env, timeout = 15000 } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, timeout);
    const finish = result => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve({ ...result, stdout, stderr, timedOut, duration: Date.now() - started });
    };
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => finish({ error, code: null, signal: null }));
    child.on('exit', (code, signal) => finish({ code, signal }));
  });
}

// The child bound is only a backstop for a hang (quiet push ~0.2 s); nothing here waits on a held lock.
function push(f, ref, extraEnv = {}, timeout = 100000) {
  return run('git', ['push', 'origin', ref], {
    cwd: f.repo, env: { ...f.env, PUSH_GUARD_SUITE_LOCK: f.lock, PUSH_GUARD_SUITE_LOCK_WAIT: '30', ...extraEnv }, timeout
  });
}

const options = { skip: unsupported, timeout: 120000 };

test('pre-push refuses a pushed commit that is not HEAD', options, async t => {
  const f = await fixture(t);
  const result = await push(f, 'old');
  assert.notEqual(result.code, 0, 'the push must be refused');
  assert.match(result.stderr, /pushed commit .* is not HEAD/);
  assert.ok(result.stderr.includes(f.oldSha), 'the message names the pushed commit');
  assert.ok(result.stderr.includes(f.headSha), 'the message names HEAD');
  assert.match(result.stderr, /PUSH_GUARD_SKIP_TESTS=1/);
  assert.equal(existsSync(f.ran), false, 'the test command must not run');
  assert.equal(existsSync(f.lock), false, 'no suite lock is taken when the check refuses');
});

test('pre-push refuses a modified tracked file', options, async t => {
  const f = await fixture(t);
  await writeFile(join(f.repo, 'README.md'), 'dirty\n');
  const result = await push(f, 'main');
  assert.notEqual(result.code, 0, 'the push must be refused');
  assert.match(result.stderr, /uncommitted changes/);
  assert.match(result.stderr, /PUSH_GUARD_SKIP_TESTS=1/);
  assert.equal(existsSync(f.ran), false, 'the test command must not run');
  assert.equal(existsSync(f.lock), false, 'no suite lock is taken when the check refuses');
});

test('pre-push refuses an untracked file', options, async t => {
  const f = await fixture(t);
  await writeFile(join(f.repo, 'untracked.txt'), 'untracked\n');
  const result = await push(f, 'main');
  assert.notEqual(result.code, 0, 'the push must be refused');
  assert.match(result.stderr, /uncommitted changes/);
  assert.equal(existsSync(f.ran), false, 'the test command must not run');
});

test('pre-push runs the suite and allows HEAD from a clean checkout', options, async t => {
  const f = await fixture(t);
  const result = await push(f, 'main');
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readFile(f.ran, 'utf8')).trim(), 'ran');
  assert.equal(git(f.root, ['--git-dir', f.remote, 'rev-parse', 'refs/heads/main'], f.env).trim(), f.headSha);
});

test('pre-push still allows PUSH_GUARD_SKIP_TESTS=1 for a commit other than HEAD', options, async t => {
  const f = await fixture(t);
  const result = await push(f, 'old', { PUSH_GUARD_SKIP_TESTS: '1' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(existsSync(f.ran), false, 'no tests run when they are skipped');
  assert.equal(existsSync(f.lock), false, 'no lock is taken when tests are skipped');
  assert.equal(git(f.root, ['--git-dir', f.remote, 'rev-parse', 'refs/heads/old'], f.env).trim(), f.oldSha);
});

test('pre-push does not refuse deleting a remote branch', options, async t => {
  const f = await fixture(t);
  const published = await push(f, 'old', { PUSH_GUARD_SKIP_TESTS: '1' });
  assert.equal(published.code, 0, published.stderr);
  const result = await push(f, ':old');
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /pushed commit .* is not HEAD/);
  assert.doesNotMatch(result.stderr, /uncommitted changes/);
  const remoteRef = spawnSync('git', ['--git-dir', f.remote, 'rev-parse', '--verify', 'refs/heads/old'], { env: f.env, encoding: 'utf8', timeout: 15000 });
  assert.notEqual(remoteRef.status, 0, 'the remote branch is deleted');
});

test('pre-push allows HEAD when the suite is slow', options, async t => {
  // 22 s is past the old fixed 20 s child bound; the hook is slow, not stuck.
  const f = await fixture(t);
  const result = await push(f, 'main', { SUITE_DELAY: '22' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readFile(f.ran, 'utf8')).trim(), 'ran');
});
