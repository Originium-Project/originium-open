// Linux only: the guard is exercised with the real hook, which relies on flock and /proc elsewhere; skipped when missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { accessSync, constants, rmSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../pre-push', import.meta.url));
const checkIdentity = fileURLToPath(new URL('../check-identity.sh', import.meta.url));
const flock = (() => { try { return spawnSync('flock', ['--version'], { stdio: 'ignore' }).status === 0; } catch { return false; } })();
const proc = (() => { try { accessSync('/proc/self/fdinfo', constants.R_OK); return true; } catch { return false; } })();
const options = { skip: !flock || !proc ? 'flock(1) or /proc/self/fdinfo is unavailable' : false, timeout: 60000 };

const AGENT = 'agent@users.noreply.local';
const PERSON = 'person@example.com';

function baseEnv(home) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_') && !key.startsWith('PUSH_GUARD_')) env[key] = value;
  return { ...env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' };
}

function git(cwd, args, env) {
  const run = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout: 15000 });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed (${run.status}): ${run.stderr}`);
  return run.stdout;
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'push-guard-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'), repo = join(root, 'repo'), remote = join(root, 'remote.git'), hooks = join(root, 'hooks');
  await mkdir(home, { recursive: true });
  const env = baseEnv(home);
  git(root, ['init', '--bare', '--quiet', remote], env);
  git(root, ['init', '--quiet', repo], env);
  git(repo, ['config', 'commit.gpgsign', 'false'], env);
  git(repo, ['config', 'core.hooksPath', hooks], env);
  await mkdir(hooks, { recursive: true });
  await copyFile(hook, join(hooks, 'pre-push'));
  await copyFile(checkIdentity, join(hooks, 'check-identity.sh'));
  await chmod(join(hooks, 'pre-push'), 0o755);
  await chmod(join(hooks, 'check-identity.sh'), 0o755);
  await writeFile(join(repo, 'README.md'), 'fixture\n');
  git(repo, ['add', '-A'], env);
  git(repo, ['remote', 'add', 'origin', remote], env);
  return { repo, env };
}

const commit = (f, email, message) => {
  git(f.repo, ['-c', 'user.name=Test', '-c', `user.email=${email}`, 'commit', '--quiet', '--allow-empty', '-m', message], f.env);
  return git(f.repo, ['rev-parse', 'HEAD'], f.env).trim();
};

// No package.json in the fixture: only the identity guard runs.
const push = (f, extraEnv = {}) =>
  spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/feature'], { cwd: f.repo, env: { ...f.env, ...extraEnv }, encoding: 'utf8', timeout: 30000 });

test('an agent-address commit is pushed', options, async t => {
  const f = await fixture(t);
  commit(f, AGENT, 'agent commit');
  const result = push(f);
  assert.equal(result.status, 0, result.stderr);
});

test('a personal-address commit is refused, naming the commit, unless PUSH_GUARD_OWNER_PUSH=1', options, async t => {
  const f = await fixture(t);
  commit(f, AGENT, 'agent commit');
  const sha = commit(f, PERSON, 'personal commit');
  const refused = push(f);
  assert.notEqual(refused.status, 0, 'the push must be refused');
  assert.ok(refused.stderr.includes(sha.slice(0, 7)), `the message names the commit: ${refused.stderr}`);
  const allowed = push(f, { PUSH_GUARD_OWNER_PUSH: '1' });
  assert.equal(allowed.status, 0, allowed.stderr);
});

test('a custom PUSH_GUARD_ROLE_PATTERN is honoured', options, async t => {
  const f = await fixture(t);
  commit(f, PERSON, 'personal commit');
  assert.notEqual(push(f).status, 0, 'refused under the default pattern');
  const result = push(f, { PUSH_GUARD_ROLE_PATTERN: '*@example.com' });
  assert.equal(result.status, 0, result.stderr);
});

// PUSH_GUARD_SCAN: run as "$PUSH_GUARD_SCAN <range>" with the range as ONE argument; a failure blocks the push.
test('PUSH_GUARD_SCAN gets the range as one argument, and its failure blocks the push', options, async t => {
  const f = await fixture(t);
  commit(f, AGENT, 'agent commit');
  const record = join(f.repo, '..', 'scan-args.txt');
  const script = join(f.repo, '..', 'scan.sh');
  await writeFile(script, `#!/usr/bin/env bash\nprintf '%s\\n' "$#" "$1" > "${record}"\n[ -z "\${SCAN_FAIL:-}" ]\n`);
  await chmod(script, 0o755);
  const passed = push(f, { PUSH_GUARD_SCAN: script });
  assert.equal(passed.status, 0, passed.stderr);
  const [count, range] = (await readFile(record, 'utf8')).split('\n');
  assert.equal(count, '1', 'one argument');
  assert.match(range, /^[0-9a-f]{40} --not --remotes$/, `a new branch is scanned as "<sha> --not --remotes": ${range}`);
  commit(f, AGENT, 'second agent commit');
  const failed = push(f, { PUSH_GUARD_SCAN: script, SCAN_FAIL: '1' });
  assert.notEqual(failed.status, 0, 'a failing scan blocks the push');
  assert.match(failed.stderr, /the scan failed for /);
});
