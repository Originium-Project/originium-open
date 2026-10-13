#!/usr/bin/env bash
# All target execution is confined. No downloads or unsandboxed fallback.
set -euo pipefail
check_started=$SECONDS
require_approved=false
current_tree=false
case "${1:-}" in
  '') [[ $# == 0 ]] || { echo 'unexpected arguments' >&2; exit 2; } ;;
  --current-tree) [[ $# == 1 ]] || { echo 'unexpected arguments' >&2; exit 2; }; current_tree=true ;;
  --require-approved) [[ $# == 1 ]] || { echo 'unexpected arguments' >&2; exit 2; }; require_approved=true ;;
  *) echo 'usage: scripts/check-local.sh [--current-tree | --require-approved]' >&2; exit 2 ;;
esac
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
fail() { echo "check-local: NOT RUN: $*" >&2; exit 1; }
for tool in bwrap prlimit timeout readlink find git env mktemp rm; do
  command -v "$tool" >/dev/null || fail "missing $tool"
done
bwrap=$(command -v bwrap)
"$bwrap" --help | /usr/bin/grep -F -- --size >/dev/null || fail 'Bubblewrap --size support required'
venv=$(readlink -f -- "${RESEARCH_MCP_VENV:-$root/projects/research-mcp/.venv}") || fail 'virtualenv unavailable'
case "$venv" in
  /|/usr|/usr/local|/home|/root|/opt|"$root") fail 'overly broad virtualenv path' ;;
esac
[[ -f "$venv/pyvenv.cfg" && -x "$venv/bin/python" ]] || fail 'select an already installed virtualenv with RESEARCH_MCP_VENV'
interpreter=$(readlink -f -- "$venv/bin/python")
base=$(dirname -- "$(dirname -- "$interpreter")")
version=$(basename -- "$interpreter")
[[ "$version" =~ ^python(3\.[0-9]+)$ ]] || fail 'interpreter must resolve to a versioned Python binary'
version=${BASH_REMATCH[1]}
stdlib="$base/lib/python$version"
[[ -d "$stdlib" && -f "$stdlib/os.py" ]] || fail 'cannot locate exact interpreter standard library'
case "$base" in /|/home|/root|/opt|"$root") fail 'overly broad interpreter base' ;; esac
# Never mount /usr, HOME, an interpreter base or an original source repository.
mounts=(--ro-bind "$root" /repo --ro-bind "$venv" /runtime/venv)
for binary in /usr/bin/bash /usr/bin/env /usr/bin/prlimit /usr/bin/git; do
  [[ -x "$binary" ]] || fail "missing $binary"
  mounts+=(--ro-bind "$binary" "$binary")
done
mounts+=(--symlink usr/bin /bin --ro-bind "$interpreter" "$interpreter" --ro-bind "$stdlib" "$stdlib")
if $current_tree; then
  [[ -x /usr/bin/node ]] || fail 'current-tree checks require Node.js 18+'
  mounts+=(--ro-bind /usr/bin/node /usr/bin/node)
  # Some distribution builds externalize these Node builtins. Mount only these
  # packages, never the full host JavaScript package tree or user configuration.
  for package in acorn acorn-walk cjs-module-lexer undici; do
    path="/usr/share/nodejs/$package"
    [[ ! -d "$path" ]] || mounts+=(--ro-bind "$path" "$path")
  done
fi
for alias in python python3; do
  [[ ! -e "$base/bin/$alias" ]] || mounts+=(--ro-bind "$interpreter" "$base/bin/$alias")
done
# Platform shared libraries, not full /usr/lib or any host configuration.
for lib in /usr/lib/x86_64-linux-gnu /usr/lib/aarch64-linux-gnu /usr/lib64; do
  [[ ! -d "$lib" ]] || mounts+=(--ro-bind "$lib" "$lib")
done
for lib in /lib /lib64; do
  if [[ -L "$lib" ]]; then mounts+=(--symlink "$(readlink "$lib")" "$lib")
  elif [[ -d "$lib" ]]; then mounts+=(--ro-bind "$lib" "$lib")
  fi
done
for lib in "$base"/lib/libpython"$version"*.so*; do
  [[ ! -f "$lib" ]] || mounts+=(--ro-bind "$lib" "$lib")
done
# An exact stdlib mount must not leak globally installed packages or site customization.
for sub in site-packages dist-packages; do
  [[ ! -d "$stdlib/$sub" ]] || mounts+=(--size 4096 --tmpfs "$stdlib/$sub" --remount-ro "$stdlib/$sub")
done
for custom in sitecustomize.py usercustomize.py; do
  if [[ -L "$stdlib/$custom" ]]; then
    target=$(readlink -- "$stdlib/$custom")
    [[ "$target" == "/etc/python$version/$custom" ]] || fail 'unsupported stdlib customization symlink'
    # Create only an empty sandbox directory; never mount host /etc.
    mounts+=(--dir "/etc/python$version" --ro-bind /dev/null "$target")
  elif [[ -e "$stdlib/$custom" ]]; then
    mounts+=(--ro-bind /dev/null "$stdlib/$custom")
  fi
done
# Prune private directories before descent; inspect names, never their contents.
# Mask every nesting level, including a component-local virtualenv and client config.
mask_bytes=8192
mask_scan_complete=false
while IFS= read -r -d '' path; do
  if [[ "$path" == MASK_SCAN_COMPLETE ]]; then mask_scan_complete=true; continue; fi
  [[ ! -L "$path" ]] || fail 'symlink in excluded state; refusing ambiguous mount'
  dest="/repo/${path#"$root/"}"
  if [[ -d "$path" ]]; then
    mounts+=(--size 4096 --tmpfs "$dest" --remount-ro "$dest")
    mask_bytes=$((mask_bytes + 4096))
  else
    mounts+=(--ro-bind /dev/null "$dest")
  fi
done < <(find "$root" \( -name .git -o -name .local -o -name .review-inputs -o -name .venv \
  -o -name __pycache__ -o -name .pytest_cache -o -name .pip-cache -o -name .cache \
  -o -name .node-cache -o -name .pi -o -name .claude -o -name .scratch -o -name operator-state \
  -o -name dist -o -name build -o -name '*.egg-info' -o -name '.test-scratch-*' \
  -o -name .env -o -name '.env.*' -o -name .envrc -o -name pi-client-config.json \
  -o -name .coverage -o -name '*.log' -o -name '*.pyc' -o -name '*.pyo' -o -name '.gitleaks-report*' \) -print0 -prune && printf '%s\0' MASK_SCAN_COMPLETE)
$mask_scan_complete || fail 'excluded-state name scan failed'
# The only host Python is this reviewed, data-only trusted launcher, isolated
# from site customization and repository imports. Guards/tests stay inside bwrap.
projection_reserve=0
inventory_git="$root/.git"
if $require_approved; then
  projection=$(/usr/bin/mktemp -d /tmp/research-mcp-public-git.XXXXXXXX) || fail 'projection scratch unavailable'
  trap '/usr/bin/rm -rf -- "$projection"' EXIT
  projection_reserve=50331648
  # No --nproc here: outside the user namespace RLIMIT_NPROC counts every process
  # of the real host UID, so a busy account would make the launcher's one Git fork
  # fail. The launcher is reviewed, data-only and sequential (one subprocess.run
  # Git child at a time, no threads/shell/background jobs); its remaining bounds
  # are address space, CPU, file descriptors, file size and the 60s timeout. The
  # target sandbox's own --nproc=64 below is unchanged.
  /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/timeout --kill-after=5 60 \
    /usr/bin/prlimit --as=2147483648 --cpu=90 --nofile=256 --fsize=16777216 \
    -- "$interpreter" -I -S - "$root" "$projection" <<'TRUSTED_PROJECTION_PY'
# BEGIN TRUSTED_GIT_PROJECTION
"""Trusted data-only launcher: never import or execute repository Python code.

The parent reviews this small launcher separately from sandboxed target code.
Only the candidate's own Git metadata is read. No original repository is used.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zlib

MAX_OBJECT = 8 * 1024 * 1024
MAX_TOTAL = 16 * 1024 * 1024
MAX_OBJECTS = 256
MAX_METADATA = 1024 * 1024
PRIVATE_DIRS = {'.git', '.local', '.review-inputs', '.venv', '__pycache__',
                '.pytest_cache', '.pip-cache', '.cache', '.node-cache', '.pi',
                '.claude', '.scratch', 'operator-state', 'dist', 'build'}
PRIVATE_FILES = {'.env', '.envrc', 'pi-client-config.json', '.coverage'}


def private(name):
    return any(p in PRIVATE_DIRS or p in PRIVATE_FILES
               or p.startswith(('.env.', '.test-scratch-', '.gitleaks-report'))
               or p.endswith(('.egg-info', '.pyc', '.pyo', '.log'))
               for p in name.split('/'))


def safe_name(name):
    return (isinstance(name, str) and bool(name) and len(name.encode('utf-8')) <= 1024
            and all(ord(c) >= 32 and ord(c) != 127 for c in name)
            and '\\' not in name and not private(name)
            and all(p not in {'', '.', '..'} and not p.startswith('AGENTS')
                    and p != 'CLAUDE.md' for p in name.split('/')))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def regular(path, directory=False):
    # Never follow symlinks in either the path or its ancestors.
    for parent in (path, *path.parents):
        mode = parent.lstat().st_mode
        expected_dir = directory or parent != path
        require(stat.S_ISDIR(mode) if expected_dir else stat.S_ISREG(mode),
                'nonregular or symlink metadata/path')


def bounded_read(path, limit=MAX_METADATA):
    regular(path)
    with path.open('rb') as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, 'input exceeds byte bound')
    return data


def project_git(root, scratch):
    root, scratch = Path(root).absolute(), Path(scratch).absolute()
    regular(root, directory=True)
    regular(scratch, directory=True)
    require(not any(scratch.iterdir()), 'projection scratch must be empty')
    require(not scratch.is_relative_to(root), 'projection scratch must be separate')
    gitdir = root / '.git'
    regular(gitdir, directory=True)
    for name in ('HEAD', 'index', 'config'):
        regular(gitdir / name)
    # Fail closed on linked worktrees, alternate object stores and grafts.
    for name in ('commondir', 'objects/info/alternates', 'objects/info/http-alternates', 'info/grafts', 'shallow'):
        require(not os.path.lexists(gitdir / name), 'unsupported indirect Git metadata')
    regular(gitdir / 'objects', directory=True)
    # Loose object buckets and pack files may not redirect reads outside this repo.
    for entry in (gitdir / 'objects').iterdir():
        regular(entry, directory=True)
        for child in entry.iterdir():
            regular(child)
    for optional in ('packed-refs',):
        if os.path.lexists(gitdir / optional):
            regular(gitdir / optional)
    # Resolve only the actual HEAD/ref. Never load source Git configuration,
    # hooks, other refs, or replacement objects into the reader repository.
    def actual_head():
        value = bounded_read(gitdir / 'HEAD', 1024).decode('ascii').strip()
        seen = set()
        for _ in range(8):
            if not value.startswith('ref: '):
                require(re.fullmatch(r'[0-9a-f]{40}', value) is not None, 'invalid actual HEAD')
                return value
            reference = value[5:]
            require(reference.startswith('refs/') and safe_name(reference)
                    and re.fullmatch(r'[A-Za-z0-9_./-]+', reference) is not None
                    and '..' not in reference and reference not in seen, 'invalid symbolic HEAD')
            seen.add(reference)
            path = gitdir / reference
            if os.path.lexists(path):
                value = bounded_read(path, 1024).decode('ascii').strip()
            else:
                packed = bounded_read(gitdir / 'packed-refs').decode('ascii').splitlines()
                matches = [line.split(' ', 1)[0] for line in packed
                           if not line.startswith(('#', '^')) and line.endswith(' ' + reference)]
                require(len(matches) == 1, 'missing or ambiguous actual HEAD ref')
                value = matches[0]
        raise ValueError('symbolic HEAD depth exceeded')

    head = actual_head()
    reader = scratch / 'reader.git'
    reader.mkdir(mode=0o700)
    (reader / 'objects').mkdir()
    (reader / 'refs').mkdir()
    (reader / 'HEAD').write_text(head + '\n')
    (reader / 'config').write_text('[core]\n\trepositoryformatversion = 0\n\tbare = false\n')

    env = {'PATH': '/usr/bin:/bin', 'GIT_CONFIG_NOSYSTEM': '1',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null',
           'GIT_OPTIONAL_LOCKS': '0', 'GIT_NO_REPLACE_OBJECTS': '1',
           'GIT_TERMINAL_PROMPT': '0', 'GIT_NO_LAZY_FETCH': '1'}

    def git(directory, *args, limit=MAX_METADATA, input=None):
        # Fixed Git subcommands only; no revision/path expressions from filenames.
        argv = ['/usr/bin/git', '--git-dir=' + str(directory), '--work-tree=' + str(root),
                '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
                '-c', 'core.untrackedCache=false', '-c', 'core.useReplaceRefs=false',
                '-c', 'core.commitGraph=false', '-c', 'maintenance.auto=false',
                '-c', 'gc.auto=0', *args]
        command_env = dict(env)
        if directory == reader:
            command_env['GIT_OBJECT_DIRECTORY'] = str(gitdir / 'objects')
            command_env['GIT_INDEX_FILE'] = str(gitdir / 'index')
        # RLIMIT_FSIZE bounds this temporary output even for malformed Git metadata.
        with tempfile.TemporaryFile(dir=scratch) as output:
            result = subprocess.run(argv, cwd=scratch, env=command_env, input=input,
                                    stdout=output, stderr=subprocess.DEVNULL, timeout=15)
            require(result.returncode == 0, 'Git metadata/object read failed')
            require(output.tell() <= limit, 'Git output exceeds byte bound')
            output.seek(0)
            return output.read(limit + 1)

    def oid(value):
        require(re.fullmatch(r'[0-9a-f]{40}', value) is not None, 'invalid SHA-1 object id')
        return value

    def records(raw):
        require(not raw or raw.endswith(b'\0'), 'unterminated Git records')
        result = raw.decode('utf-8').split('\0')[:-1]
        require(len(result) <= MAX_OBJECTS, 'Git record count exceeds bound')
        return result

    manifest = json.loads(bounded_read(root / 'release-manifest.json'))
    allowed = manifest['public_paths']
    require(isinstance(allowed, list) and 0 < len(allowed) <= 128
            and all(safe_name(p) for p in allowed) and len(set(allowed)) == len(allowed),
            'invalid public allowlist')
    allowed = set(allowed)
    require('release-manifest.json' in allowed and 'LICENSE' in allowed, 'missing release paths')
    require(oid(git(reader, 'rev-parse', '--verify', 'HEAD^{commit}').decode('ascii').strip()) == head,
            'actual HEAD is not a readable commit')
    commit = git(reader, 'cat-file', 'commit', head)
    tree_header = commit.split(b'\n', 1)[0]
    require(tree_header.startswith(b'tree '), 'invalid commit tree header')
    root_tree = oid(tree_header[5:].decode('ascii'))
    tree, trees = {}, {root_tree}
    # Check ALL names, including directory entries, before ANY blob reads.
    for record in records(git(reader, 'ls-tree', '-r', '-t', '-z', '--full-tree', head)):
        metadata, name = record.split('\t', 1)
        mode, kind, object_name = metadata.split(' ')
        oid(object_name)
        require(safe_name(name), 'unsafe committed name')
        if mode == '040000' and kind == 'tree':
            require(any(p.startswith(name + '/') for p in allowed), 'unexpected committed directory')
            trees.add(object_name)
        else:
            require(mode in {'100644', '100755'} and kind == 'blob', 'nonregular committed mode')
            require(name in allowed and name not in tree, 'unexpected committed path')
            tree[name] = (mode, object_name)
    require(set(tree) == allowed, 'HEAD paths differ from public allowlist')
    index_raw = git(reader, 'ls-files', '--stage', '-z', '--cached')
    index = {}
    for record in records(index_raw):
        metadata, name = record.split('\t', 1)
        mode, object_name, stage = metadata.split(' ')
        require(safe_name(name) and name in allowed and name not in index and stage == '0',
                'unexpected or unmerged index path')
        require(mode in {'100644', '100755'}, 'nonregular index mode')
        index[name] = (mode, oid(object_name))
    require(index == tree, 'actual index differs from HEAD')
    # The real public working inventory must also be exact; excluded state is pruned.
    public = set()
    def walk(directory):
        for entry in directory.iterdir():
            name = entry.relative_to(root).as_posix()
            if private(name):
                continue
            mode = entry.lstat().st_mode
            require(not stat.S_ISLNK(mode), 'public symlink')
            if stat.S_ISDIR(mode):
                walk(entry)
            else:
                require(stat.S_ISREG(mode) and name in allowed, 'unexpected public working path')
                public.add(name)
    walk(root)
    require(public == allowed, 'missing public working path')
    objects = {head: ('commit', commit)}
    total = len(commit)
    def add(object_name, kind):
        nonlocal total
        if object_name in objects:
            require(objects[object_name][0] == kind, 'object type collision')
            return objects[object_name][1]
        require(len(objects) < MAX_OBJECTS, 'object count exceeds bound')
        size = int(git(reader, 'cat-file', '-s', object_name).decode('ascii').strip())
        require(0 <= size <= MAX_OBJECT and total + size <= MAX_TOTAL, 'object byte budget exceeded')
        raw = git(reader, 'cat-file', kind, object_name, limit=MAX_OBJECT)
        require(len(raw) == size, 'object size changed')
        total += size
        objects[object_name] = (kind, raw)
        return raw
    for object_name in sorted(trees):
        add(object_name, 'tree')
    for name, (mode, object_name) in sorted(tree.items()):
        path = root / name
        raw = add(object_name, 'blob')
        require(bounded_read(path, MAX_OBJECT) == raw, 'working bytes differ from HEAD')
        file_mode = path.lstat().st_mode
        require(bool(file_mode & 0o111) == (mode == '100755')
                and (mode != '100755' or file_mode & stat.S_IXUSR), 'working mode differs from HEAD')
    # Recheck actual metadata after reads, before any reconstructed index exists.
    require(actual_head() == head
            and git(reader, 'ls-files', '--stage', '-z', '--cached') == index_raw,
            'actual HEAD/index changed during projection')
    projected = scratch / 'public.git'
    projected.mkdir(mode=0o700)
    (projected / 'objects').mkdir()
    (projected / 'refs').mkdir()
    (projected / 'HEAD').write_text(head + '\n')
    (projected / 'config').write_text('[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tlogallrefupdates = false\n\thooksPath = /dev/null\n\tfsmonitor = false\n')
    # Reserve 48MiB in the runner for this projection plus at most one 16MiB
    # transient Git output. <=256 objects, <=16MiB uncompressed, <=24MiB disk.
    for object_name, (kind, raw) in objects.items():
        envelope = kind.encode() + b' ' + str(len(raw)).encode() + b'\0' + raw
        require(hashlib.sha1(envelope).hexdigest() == object_name, 'object hash mismatch')
        destination = projected / 'objects' / object_name[:2] / object_name[2:]
        destination.parent.mkdir(exist_ok=True)
        destination.write_bytes(zlib.compress(envelope))
    # Never copy a source index: build only after exact real-index equality above.
    git(projected, 'read-tree', root_tree)
    require(git(projected, 'ls-files', '--stage', '-z', '--cached') == index_raw,
            'projected index differs from actual index')
    require(git(projected, 'rev-parse', '--verify', 'HEAD^{commit}').decode().strip() == head
            and git(projected, 'cat-file', 'commit', head) == commit, 'projected commit identity differs')
    shutil.rmtree(reader)
    allocated = sum(((p.stat().st_size + 4095) // 4096 * 4096 if p.is_file() else 4096)
                    for p in scratch.rglob('*'))
    require(allocated <= 24 * 1024 * 1024, 'projection disk budget exceeded')
    return head


if __name__ == '__main__':
    try:
        print('Verified public Git projection: ' + project_git(sys.argv[1], sys.argv[2]))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        print('check-local: projection refused: ' + str(exc), file=sys.stderr)
        sys.exit(1)
# END TRUSTED_GIT_PROJECTION
TRUSTED_PROJECTION_PY
  inventory_git="$projection/public.git"
  mounts+=(--ro-bind "$inventory_git" /repo/.git)
fi
scratch_bytes=$((134217728 - mask_bytes - projection_reserve))
((scratch_bytes > 0)) || fail 'mask count exceeds tmpfs budget'
check_remaining=$((120 - SECONDS + check_started))
((check_remaining > 0)) || fail '120-second launcher/sandbox deadline exceeded'
# Git inventory is names only. Only an approved public projection is visible. pipefail
# ensures Git errors fail the run, including ignored files force-added to index.
inventory_args=(--git-dir="$inventory_git" --work-tree="$root")
if $current_tree; then
  # Name-only local checks also support linked worktrees; approval projection
  # restrictions above remain unchanged.
  inventory_args=(-C "$root")
fi
/usr/bin/env -i PATH=/usr/bin:/bin GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_NO_REPLACE_OBJECTS=1 GIT_OPTIONAL_LOCKS=0 \
  /usr/bin/git "${inventory_args[@]}" -c core.fsmonitor=false -c core.hooksPath=/dev/null ls-files -z --cached |
  env -i PATH=/usr/bin:/bin /usr/bin/timeout --kill-after=5 "$check_remaining" "$bwrap" \
  --unshare-all --unshare-user --unshare-net --unshare-pid \
  --die-with-parent --new-session --cap-drop ALL "${mounts[@]}" \
  --proc /proc --dev /dev --remount-ro /dev --size "$scratch_bytes" --tmpfs /scratch \
  --dir /scratch/home --dir /scratch/tmp \
  --setenv HOME /scratch/home --setenv TMPDIR /scratch/tmp --setenv XDG_CACHE_HOME /scratch/cache \
  --setenv PATH /runtime/venv/bin:/usr/bin:/bin --setenv PYTHONPATH /repo/projects/research-mcp/src \
  --setenv LD_LIBRARY_PATH "$base/lib" --setenv PYTHONDONTWRITEBYTECODE 1 \
  --setenv PYTEST_DISABLE_PLUGIN_AUTOLOAD 1 --setenv GIT_CONFIG_NOSYSTEM 1 \
  --setenv GIT_CONFIG_GLOBAL /dev/null --setenv GIT_NO_REPLACE_OBJECTS 1 \
  --setenv REQUIRE_APPROVED "$require_approved" --setenv CURRENT_TREE "$current_tree" --chdir /repo --remount-ro / \
  /usr/bin/prlimit --as=2147483648 --cpu=90 --nproc=64 --nofile=256 --fsize=16777216 \
  -- /usr/bin/bash --noprofile --norc -euo pipefail -c '
    # Bash builtin read/printf avoids exposing any additional host toolchain.
    while IFS= read -r -d "" name; do printf "%s\0" "$name"; done > /scratch/tracked
    if [[ "$CURRENT_TREE" == true ]]; then
      /runtime/venv/bin/python -P scripts/check-current.py --tracked-inventory /scratch/tracked
      cd /repo/projects/token-flow-demo
      # Same commands as npm test/check, without npm configuration or downloads.
      /usr/bin/node --jitless --max-old-space-size=128 tests/run.cjs
      /usr/bin/node --jitless --max-old-space-size=128 --check data.js
      /usr/bin/node --jitless --max-old-space-size=128 --check app.js
      cd /repo
    elif [[ "$REQUIRE_APPROVED" == true ]]; then
      /runtime/venv/bin/python -P scripts/check-release.py --tracked-inventory /scratch/tracked --require-approved
    else
    /runtime/venv/bin/python -P scripts/check-release.py --tracked-inventory /scratch/tracked
    if pending_output=$(/runtime/venv/bin/python -P scripts/check-release.py --tracked-inventory /scratch/tracked --require-approved 2>&1); then
      pending_status=0
    else
      pending_status=$?
    fi
    if [[ "$pending_status" != 1 || "$pending_output" != "publication blocked: approvals, rights, licensing and decisions pending" ]]; then
      printf "unexpected approval-check result (exit %s):\n%s\n" "$pending_status" "$pending_output" >&2
      exit 1
    fi
    printf "%s\n" "$pending_output"
    fi
    cd /repo/projects/research-mcp
    /runtime/venv/bin/python -P -m pytest -q -p no:cacheprovider --basetemp=/scratch/component-tests tests
    cd /repo
    /runtime/venv/bin/python -P -m pytest -q -p no:cacheprovider --basetemp=/scratch/root-tests tests
  '
