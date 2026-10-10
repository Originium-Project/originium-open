"""Synthetic scratch candidates only; no private originals or live providers."""
import builtins
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

SPEC = importlib.util.spec_from_file_location("release_guard", Path(__file__).parents[1] / "scripts/check-release.py")
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)


@pytest.fixture
def draft(tmp_path):
    files = {
        "README.md": "# LOCAL DRAFT\nSee [policy](LICENSING.md).\n",
        "LICENSING.md": "# LOCAL DRAFT\nPENDING\n",
        "projects/research-mcp/src/sample.py": "# synthetic immutable payload\n",
        "projects/research-mcp/README.md": "[Root policy](../../LICENSING.md)\n",
        ".gitignore": ".local/\n.venv/\n.env\n",
    }
    for name, content in files.items():
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    manifest = {
        "status": "LOCAL_DRAFT",
        "source_revision": guard.SOURCE_REVISION,
        "public_paths": sorted([*files, "release-manifest.json"]),
        "immutable_imports_sha256": {
            name: hashlib.sha256(content.encode()).hexdigest()
            for name, content in files.items() if guard.immutable_path(name)
        },
        "gates": {name: {"approved": False, "evidence": "PENDING"} for name in guard.GATES},
        "decisions": {name: "PENDING" for name in ("project_license", "copyright_owner", "source_version")},
    }
    (tmp_path / "release-manifest.json").write_text(json.dumps(manifest))
    return tmp_path, manifest


def save(root, manifest):
    (root / "release-manifest.json").write_text(json.dumps(manifest))


def fixture_git(root, *args, input=None):
    # Fixture commits are permitted only in the parent's contained scratch tests.
    assert root.is_relative_to(Path("/scratch")), "Git fixtures require contained /scratch"
    return subprocess.run(
        ["/usr/bin/git", "-C", str(root), "-c", "core.fsmonitor=false",
         "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
         "-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@example.invalid", *args],
        input=input, capture_output=True, check=True,
        env={"PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"},
    ).stdout


@pytest.fixture
def approved_uncommitted(draft):
    """Dummy evidence/license is test data, never owner approval or a release grant."""
    root, manifest = draft
    manifest["status"] = "RELEASE_APPROVED"
    for gate in manifest["gates"].values():
        gate.update(approved=True, evidence="SYNTHETIC FIXTURE ONLY")
    manifest["decisions"] = {name: "SYNTHETIC FIXTURE ONLY" for name in manifest["decisions"]}
    (root / "LICENSE").write_text("Dummy fixture license; no rights granted.\n")
    manifest["public_paths"].append("LICENSE")
    save(root, manifest)
    return root, manifest


@pytest.fixture
def approved_commit(approved_uncommitted):
    root, manifest = approved_uncommitted
    fixture_git(root, "init", "-q", "--template=", "--initial-branch=fixture")
    fixture_git(root, "add", "--all")
    fixture_git(root, "commit", "-qm", "Synthetic scratch fixture only")
    return root, manifest


def test_draft_structural_and_require_approved(draft):
    root, _ = draft
    assert guard.validate(root, []) == []
    assert any("publication blocked" in e for e in guard.validate(root, [], True))


def test_cli_approved_mode_rejects(draft):
    root, _ = draft
    fixture_git(root, "init", "-q", "--template=", "--initial-branch=fixture")
    result = subprocess.run([sys.executable, str(Path(guard.__file__)), "--root", str(root), "--require-approved"], capture_output=True, text=True)
    assert result.returncode == 1
    assert result.stderr.strip() == "publication blocked: approvals, rights, licensing and decisions pending"


def test_hash_mismatch(draft):
    root, _ = draft
    (root / "projects/research-mcp/src/sample.py").write_text("changed")
    assert any("hash mismatch" in e for e in guard.validate(root, []))


def test_required_hash_cannot_be_omitted(draft):
    root, manifest = draft
    manifest["immutable_imports_sha256"] = {}
    save(root, manifest)
    assert any("hash inventory" in e for e in guard.validate(root, []))


@pytest.mark.parametrize("path", ["extra.txt", "projects/research-mcp/extra.txt"])
def test_extra_nonignored_file(draft, path):
    root, _ = draft
    (root / path).write_text("synthetic")
    assert any("unexpected public file" in e for e in guard.validate(root, []))


def test_missing_allowlisted_file(draft):
    root, _ = draft
    (root / "LICENSING.md").unlink()
    assert any("missing public file" in e for e in guard.validate(root, []))


@pytest.mark.parametrize("path", [".local/private", "projects/research-mcp/.venv/private", "projects/research-mcp/.env", "extra.txt"])
def test_extra_tracked_name_rejected_without_read(draft, path):
    root, _ = draft
    assert any("tracked path" in e for e in guard.validate(root, [path]))


def test_force_added_ignored_file_git_inventory(draft):
    root, _ = draft
    fixture_git(root, "init", "-q", "--template=", "--initial-branch=fixture")
    (root / ".local").mkdir()
    (root / ".local/private").write_text("synthetic only")
    fixture_git(root, "add", "-f", ".local/private")
    tracked = guard.tracked_names(root)
    assert tracked == [".local/private"]
    assert any("tracked path" in e for e in guard.validate(root, tracked))


def test_excluded_state_not_opened_or_traversed(draft, monkeypatch):
    root, _ = draft
    (root / ".local").mkdir()
    (root / ".local/private").write_text("synthetic")
    nested = root / "projects/research-mcp/.venv"
    nested.mkdir()
    (nested / "private").write_text("synthetic")
    (nested / "outside").symlink_to("/outside-workspace/never-traverse")
    original_bytes = Path.read_bytes
    original_text = Path.read_text
    original_path_open = Path.open
    original_open = builtins.open
    original_scan = os.scandir

    def assert_public(path):
        if isinstance(path, int):
            return
        path = Path(os.fsdecode(path)).absolute()
        assert path.is_relative_to(root), f"unexpected outside read: {path}"
        if guard.excluded(path.relative_to(root).as_posix()):
            raise AssertionError("excluded fixture read")

    def guarded_bytes(path, *args, **kwargs):
        assert_public(path)
        return original_bytes(path, *args, **kwargs)

    def guarded_text(path, *args, **kwargs):
        assert_public(path)
        return original_text(path, *args, **kwargs)

    def guarded_path_open(path, *args, **kwargs):
        assert_public(path)
        return original_path_open(path, *args, **kwargs)

    def guarded_open(path, *args, **kwargs):
        assert_public(path)
        return original_open(path, *args, **kwargs)

    def guarded_scan(path):
        assert_public(path)
        return original_scan(path)
    monkeypatch.setattr(Path, "read_bytes", guarded_bytes)
    monkeypatch.setattr(Path, "read_text", guarded_text)
    monkeypatch.setattr(Path, "open", guarded_path_open)
    monkeypatch.setattr(builtins, "open", guarded_open)
    monkeypatch.setattr(os, "scandir", guarded_scan)
    assert guard.validate(root, []) == []
    # Confirm every instrumented route actually catches the excluded fixture data.
    for private in (root / ".local/private", nested / "private"):
        for opener in (Path.read_bytes, Path.read_text, Path.open, builtins.open):
            with pytest.raises(AssertionError, match="excluded fixture read"):
                opener(private)


@pytest.mark.parametrize("path", ["README.md", "release-manifest.json", "linked-directory"])
def test_public_symlink_rejected(draft, path):
    root, _ = draft
    dest = root / path
    if dest.exists():
        dest.unlink()
    dest.symlink_to("/outside-workspace/never-open")
    assert any("symlink" in e for e in guard.validate(root, []))


def test_special_public_file_rejected(draft):
    root, _ = draft
    os.mkfifo(root / "fifo")
    assert any("special public path" in e for e in guard.validate(root, []))


@pytest.mark.parametrize("target", ["missing.md", "../../outside.md", ".local/private", "/etc/passwd"])
def test_invalid_doclink(draft, target):
    root, _ = draft
    (root / "README.md").write_text(f"LOCAL DRAFT [bad]({target})")
    assert any("doclink" in e for e in guard.validate(root, []))


@pytest.mark.parametrize("name", ["project_license", "copyright_owner", "source_version", "rights", "final_publication"])
def test_pending_gate_cannot_be_silently_approved(draft, name):
    root, manifest = draft
    manifest["gates"][name]["approved"] = True
    save(root, manifest)
    errors = guard.validate(root, [])
    assert any("lacks evidence" in e for e in errors)
    assert any("remain pending" in e for e in errors)


def test_release_approved_without_license_rejected(draft):
    root, manifest = draft
    manifest["status"] = "RELEASE_APPROVED"
    for gate in manifest["gates"].values():
        gate.update(approved=True, evidence="synthetic review reference")
    manifest["decisions"] = {name: "synthetic decision" for name in manifest["decisions"]}
    save(root, manifest)
    assert any("LICENSE" in e for e in guard.validate(root, [], True))


def test_missing_gate_or_owner_decision_rejected(draft):
    root, manifest = draft
    del manifest["gates"]["source_version"]
    del manifest["decisions"]["copyright_owner"]
    save(root, manifest)
    errors = guard.validate(root, [])
    assert any("release gates" in e for e in errors)
    assert any("decisions" in e for e in errors)


@pytest.mark.parametrize("path", ["../outside", "/outside", ".local/private", "a/../b"])
def test_unsafe_allowlist(draft, path):
    root, manifest = draft
    manifest["public_paths"].append(path)
    save(root, manifest)
    assert guard.validate(root, [])


def test_draft_license_not_silently_added(draft):
    root, manifest = draft
    (root / "LICENSE").write_text("synthetic")
    manifest["public_paths"].append("LICENSE")
    save(root, manifest)
    assert any("without LICENSE" in e for e in guard.validate(root, []))


def test_unborn_untracked_draft_needs_no_approved_git_inspection(draft, monkeypatch):
    root, _ = draft
    fixture_git(root, "init", "-q", "--template=", "--initial-branch=fixture")

    def forbidden(*args):
        raise AssertionError("LOCAL_DRAFT must not inspect approved Git tree")

    monkeypatch.setattr(guard, "approved_tree_errors", forbidden)
    assert guard.validate(root, guard.tracked_names(root)) == []


@pytest.mark.parametrize("state", ["missing", "unborn", "staged"])
def test_approved_without_commit_fails(approved_uncommitted, state):
    root, _ = approved_uncommitted
    if state != "missing":
        fixture_git(root, "init", "-q", "--template=", "--initial-branch=fixture")
    if state == "staged":
        fixture_git(root, "add", "--all")
    for require in (False, True):
        assert any("concrete HEAD" in e for e in guard.validate(root, [], require))


def test_synthetic_approved_commit_succeeds_only_in_fixture(approved_commit):
    root, _ = approved_commit
    assert guard.validate(root, [], False) == []
    assert guard.validate(root, [], True) == []
    result = subprocess.run(
        [sys.executable, "-P", str(Path(guard.__file__)), "--root", str(root), "--require-approved"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("mutation", ["bytes", "restored-bytes", "mode", "removed", "ignored-extra", "unmerged"])
def test_approved_index_must_equal_head(approved_commit, mutation):
    root, _ = approved_commit
    if mutation in {"bytes", "restored-bytes"}:
        original = (root / "README.md").read_bytes()
        (root / "README.md").write_bytes(original + b"\nSynthetic staged change.\n")
        fixture_git(root, "add", "README.md")
        if mutation == "restored-bytes":
            (root / "README.md").write_bytes(original)
    elif mutation == "mode":
        fixture_git(root, "update-index", "--chmod=+x", "README.md")
    elif mutation == "removed":
        fixture_git(root, "update-index", "--force-remove", "README.md")
    elif mutation == "ignored-extra":
        (root / ".local").mkdir()
        (root / ".local/private").write_text("Synthetic excluded index payload.\n")
        fixture_git(root, "add", "-f", ".local/private")
    else:
        oid = fixture_git(root, "rev-parse", "HEAD:README.md").decode().strip()
        fixture_git(root, "update-index", "--index-info", input=(
            "0 " + "0" * len(oid) + "\tREADME.md\n"
            f"100644 {oid} 1\tREADME.md\n100644 {oid} 2\tREADME.md\n"
        ).encode())
    # Empty caller inventory cannot bypass the direct approved-mode index check.
    errors = guard.validate(root, [], True)
    assert any(e.startswith(("Git index must match", "unexpected or excluded index path:",
                             "unmerged or duplicate index path:")) for e in errors)


@pytest.mark.parametrize("mutation", ["bytes", "mode"])
def test_approved_worktree_must_equal_committed_bytes_and_modes(approved_commit, mutation):
    root, _ = approved_commit
    if mutation == "bytes":
        with (root / "README.md").open("ab") as stream:
            stream.write(b"\nSynthetic unstaged change.\n")
    else:
        (root / "README.md").chmod(0o755)
    assert any(f"working-tree {('bytes' if mutation == 'bytes' else 'executable mode')}" in e
               for e in guard.validate(root, [], True))


@pytest.mark.parametrize("path", [".local/private", "projects/research-mcp/.venv/private", "extra.txt"])
def test_approved_extra_commit_paths_rejected_before_blob_reads(approved_commit, path, monkeypatch):
    root, _ = approved_commit
    extra = root / path
    extra.parent.mkdir(parents=True, exist_ok=True)
    extra.write_text("Synthetic excluded/unlisted committed payload.\n")
    fixture_git(root, "add", "-f", "--", path)
    fixture_git(root, "commit", "-qm", "Synthetic extra-path fixture")
    extra.unlink()  # Avoid a working-inventory failure hiding the HEAD-tree check.
    original_run = subprocess.run

    def no_blob_reads(argv, *args, **kwargs):
        assert "cat-file" not in argv, "invalid HEAD names must reject before blob reads"
        return original_run(argv, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", no_blob_reads)
    assert any("committed path" in e for e in guard.validate(root, [], True))


@pytest.mark.parametrize("mode", ["120000", "160000"])
def test_approved_nonregular_head_modes_rejected(approved_commit, mode, monkeypatch):
    root, _ = approved_commit
    object_name = "HEAD:README.md" if mode == "120000" else "HEAD"
    oid = fixture_git(root, "rev-parse", object_name).decode().strip()
    fixture_git(root, "update-index", "--cacheinfo", f"{mode},{oid},README.md")
    fixture_git(root, "commit", "-qm", "Synthetic nonregular-tree fixture")
    original_run = subprocess.run

    def no_blob_reads(argv, *args, **kwargs):
        assert "cat-file" not in argv, "nonregular HEAD must reject before blob reads"
        return original_run(argv, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", no_blob_reads)
    assert any("nonregular" in e for e in guard.validate(root, [], True))


@pytest.mark.parametrize("path", ["release-manifest.json", "LICENSE"])
def test_approved_required_public_files_must_be_committed(approved_commit, path):
    root, _ = approved_commit
    fixture_git(root, "update-index", "--force-remove", path)
    fixture_git(root, "commit", "-qm", "Synthetic missing-tree-path fixture")
    # Working bytes remain present: only the exact HEAD inventory can catch this.
    assert any("HEAD path inventory" in e for e in guard.validate(root, [], True))


def test_approved_git_ignores_caller_environment(approved_commit, monkeypatch):
    root, manifest = approved_commit
    for name, value in {
        "GIT_DIR": "/nonexistent-fixture-repo", "GIT_WORK_TREE": "/nonexistent-fixture-worktree",
        "GIT_INDEX_FILE": "/nonexistent-fixture-index", "GIT_CONFIG_COUNT": "1",
        "GIT_CONFIG_KEY_0": "core.fsmonitor", "GIT_CONFIG_VALUE_0": "/nonexistent-fixture-command",
        "GIT_CONFIG_PARAMETERS": "invalid fixture config", "GIT_OBJECT_DIRECTORY": "/nonexistent-fixture-objects",
        "GIT_CONFIG_GLOBAL": "/nonexistent-fixture-config", "GIT_CONFIG_SYSTEM": "/nonexistent-fixture-config",
    }.items():
        monkeypatch.setenv(name, value)
    assert set(guard.tracked_names(root)) == set(manifest["public_paths"])
    assert guard.validate(root, [], True) == []


@pytest.mark.parametrize("command", ["ls-tree", "ls-files", "cat-file"])
def test_approved_git_read_errors_fail_closed(approved_commit, monkeypatch, command):
    root, _ = approved_commit
    original_run = subprocess.run

    def fail_read(argv, *args, **kwargs):
        if command in argv:
            raise subprocess.CalledProcessError(1, argv)
        return original_run(argv, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", fail_read)
    assert any("readable concrete HEAD" in e for e in guard.validate(root, [], True))


@pytest.fixture
def candidate(draft):
    """Synthetic licensed candidate; evidence strings are explicitly test data."""
    root, manifest = draft
    component = root / 'projects/research-mcp'
    (root / 'README.md').write_text('# Licensed release candidate\n')
    (root / 'LICENSING.md').write_text('Synthetic candidate only; not publication evidence.\n')
    (root / 'LICENSE').write_text(guard.MIT_LICENSE)
    (component / 'LICENSE').write_text(guard.MIT_LICENSE)
    (component / 'pyproject.toml').write_text('[project]\nlicense = "MIT"\nlicense-files = ["LICENSE"]\n')
    samples = component / 'reference_samples'
    samples.mkdir()
    (samples / 'crossref.json').write_text('{"message": {"author": []}}\n')
    (samples / 'openalex.json').write_text('{}\n')
    (samples / 'arxiv.xml').write_text('<feed/>\n')
    records = []
    for provider, filename, timestamp in (
        ('crossref', 'crossref.json', '2026-09-28T00:24:22.882280+00:00'),
        ('openalex', 'openalex.json', '2026-09-28T00:24:22.882625+00:00'),
        ('arxiv', 'arxiv.xml', '2026-09-28T00:24:22.882884+00:00'),
    ):
        raw = (samples / filename).read_bytes()
        record = dict(provider=provider, file=filename, observed_at=timestamp,
                      http_status=200, status='retrieved_public_sample', bytes=len(raw),
                      sha256=hashlib.sha256(raw).hexdigest())
        if provider in guard.REMOVED_FIELDS:
            source_hash, source_bytes = guard.DERIVED_SOURCES[guard.COMPONENT + 'reference_samples/' + filename]
            record.update(source_sha256=source_hash, source_bytes=source_bytes,
                          derivation=dict(removed_fields=guard.REMOVED_FIELDS[provider],
                                          reason='Synthetic derivation', no_new_query=True))
        records.append(record)
    (samples / 'OBSERVATIONS.json').write_text(json.dumps({'records': records}))
    for i in range(16):
        (component / f'src/synthetic_{i}.py').write_text('# synthetic payload\n')
    manifest['public_paths'] = sorted(guard.inventory(root)[0])
    manifest['immutable_imports_sha256'] = {
        name: hashlib.sha256((root / name).read_bytes()).hexdigest()
        for name in manifest['public_paths'] if guard.immutable_path(name)
    }
    assert len(manifest['immutable_imports_sha256']) == 22
    manifest['derived_payloads'] = {
        name: dict(source_sha256=source_hash, source_bytes=source_bytes,
                   current_sha256=hashlib.sha256((root / name).read_bytes()).hexdigest(),
                   current_bytes=(root / name).stat().st_size, reason='SYNTHETIC FIXTURE ONLY')
        for name, (source_hash, source_bytes) in guard.DERIVED_SOURCES.items()
    }
    manifest['schema_version'] = 1
    manifest['status'] = 'RELEASE_CANDIDATE'
    manifest['decisions'] = dict(project_license='MIT', copyright_owner='Originium Project contributors',
                                 source_version=guard.SOURCE_REVISION)
    for name in manifest['decisions']:
        manifest['gates'][name] = dict(approved=True, evidence='SYNTHETIC FIXTURE ONLY')
    save(root, manifest)
    return root, manifest


def test_candidate_allows_evidenced_partial_gates_without_git(candidate, monkeypatch):
    root, manifest = candidate
    def forbidden(*args):
        raise AssertionError('candidate must not inspect a committed Git tree')
    monkeypatch.setattr(guard, 'approved_tree_errors', forbidden)
    assert guard.validate(root, []) == []
    assert guard.validate(root, [], True) == ['publication blocked: approvals, rights, licensing and decisions pending']
    manifest['gates']['rights'] = dict(approved=True, evidence='SYNTHETIC REVIEW ONLY')
    save(root, manifest)
    assert guard.validate(root, []) == []


@pytest.mark.parametrize('decision', ['project_license', 'copyright_owner', 'source_version'])
def test_candidate_decisions_and_their_evidence_required(candidate, decision):
    root, manifest = candidate
    manifest['decisions'][decision] = 'PENDING'
    save(root, manifest)
    assert any('resolved' in e for e in guard.validate(root, []))
    manifest['gates'][decision] = dict(approved=False, evidence='PENDING')
    save(root, manifest)
    assert any('corresponding gate' in e for e in guard.validate(root, []))


@pytest.mark.parametrize('name', ['LICENSE', 'projects/research-mcp/LICENSE'])
@pytest.mark.parametrize('mutation', ['missing', 'holder', 'permission'])
def test_candidate_exact_license_required(candidate, name, mutation):
    root, _ = candidate
    path = root / name
    if mutation == 'missing':
        path.unlink()
    elif mutation == 'holder':
        path.write_text(guard.MIT_LICENSE.replace('2026 Originium Project contributors', '2025 Other'))
    else:
        path.write_text('MIT License\n')
    assert any('MIT LICENSE' in e for e in guard.validate(root, []))


@pytest.mark.parametrize('mutation', ['missing', 'extra', 'source-hash', 'source-bytes', 'current-hash',
                                      'current-bytes', 'boolean-bytes', 'reason', 'extra-field', 'wrong-type'])
def test_derived_metadata_strict_schema(candidate, mutation):
    root, manifest = candidate
    name = guard.COMPONENT + 'pyproject.toml'
    entry = manifest['derived_payloads'][name]
    if mutation == 'missing':
        del manifest['derived_payloads'][name]
    elif mutation == 'extra':
        manifest['derived_payloads']['.local/private'] = dict(entry)
    elif mutation == 'source-hash':
        entry['source_sha256'] = '0' * 64
    elif mutation == 'source-bytes':
        entry['source_bytes'] += 1
    elif mutation == 'current-hash':
        entry['current_sha256'] = '0' * 64
    elif mutation == 'current-bytes':
        entry['current_bytes'] += 1
    elif mutation == 'boolean-bytes':
        entry['current_bytes'] = True
    elif mutation == 'reason':
        entry['reason'] = 'PENDING'
    elif mutation == 'extra-field':
        entry['approval'] = True
    else:
        manifest['derived_payloads'][name] = []
    save(root, manifest)
    assert any('derived' in e for e in guard.validate(root, []))


def refresh_derived(root, manifest, name):
    raw = (root / name).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    manifest['immutable_imports_sha256'][name] = digest
    manifest['derived_payloads'][name].update(current_sha256=digest, current_bytes=len(raw))
    save(root, manifest)


@pytest.mark.parametrize('provider_index', [0, 1], ids=['crossref', 'openalex'])
@pytest.mark.parametrize('mutation', ['sha256', 'bytes', 'observed_at', 'http_status', 'source_sha256',
                                      'source_bytes', 'no_new_query', 'removed_fields', 'extra-derivation'])
def test_observation_consistency_cannot_be_bypassed_by_rehash(candidate, mutation, provider_index):
    root, manifest = candidate
    name = guard.COMPONENT + 'reference_samples/OBSERVATIONS.json'
    data = json.loads((root / name).read_text())
    record = data['records'][provider_index]
    if mutation in {'sha256', 'source_sha256'}:
        record[mutation] = '0' * 64
    elif mutation in {'bytes', 'source_bytes', 'http_status'}:
        record[mutation] += 1
    elif mutation == 'observed_at':
        record[mutation] = '2026-10-10T00:00:00+00:00'
    elif mutation == 'no_new_query':
        record['derivation'][mutation] = False
    elif mutation == 'removed_fields':
        record['derivation'][mutation] = ['message.title']
    else:
        record['derivation']['approval'] = True
    (root / name).write_text(json.dumps(data))
    refresh_derived(root, manifest, name)
    assert guard.validate(root, [])


def test_candidate_pep639_cannot_be_bypassed_by_rehash(candidate):
    root, manifest = candidate
    name = guard.COMPONENT + 'pyproject.toml'
    (root / name).write_text('[project]\nlicense = "Apache-2.0"\nlicense-files = ["LICENSE"]\n')
    refresh_derived(root, manifest, name)
    assert any('PEP 639' in e for e in guard.validate(root, []))


def test_candidate_relabeling_does_not_approve_release(candidate):
    root, manifest = candidate
    manifest['status'] = 'RELEASE_APPROVED'
    save(root, manifest)
    assert any('all approvals' in e for e in guard.validate(root, [], True))
    for gate in manifest['gates'].values():
        gate.update(approved=True, evidence='SYNTHETIC FIXTURE ONLY')
    save(root, manifest)
    assert any('concrete HEAD' in e for e in guard.validate(root, [], True))


def test_frozen_candidate_inventory_and_license_consistency():
    # Public release data only; no Git/private state. All mutations use scratch.
    root = Path(__file__).parents[1]
    manifest = json.loads((root / 'release-manifest.json').read_text())
    assert len(manifest['public_paths']) == 44
    assert len(manifest['immutable_imports_sha256']) == 22
    assert len(manifest['derived_payloads']) == 4
    assert len(set(manifest['immutable_imports_sha256']) - set(manifest['derived_payloads'])) == 18
    assert guard.derived_errors(root, manifest, set(manifest['public_paths'])) == []
    assert guard.licensed_candidate_errors(root, manifest, set(manifest['public_paths']),
                                            set(manifest['public_paths'])) == []
    for name, digest in manifest['immutable_imports_sha256'].items():
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest


def test_crossref_affiliation_removal_preserves_parser_output():
    from originium_research_mcp.providers import crossref
    sanitized = {'DOI': '10.1234/synthetic', 'title': ['Synthetic title'],
                 'author': [{'given': 'Synthetic', 'family': 'Author'}]}
    with_prose = json.loads(json.dumps(sanitized))
    with_prose['author'][0]['affiliation'] = [{'name': 'Synthetic biography never used by parser.'}]
    assert crossref(sanitized) == crossref(with_prose)


OPENALEX = guard.COMPONENT + 'reference_samples/openalex.json'
OBSERVATIONS = guard.COMPONENT + 'reference_samples/OBSERVATIONS.json'


def test_openalex_raw_prose_removal_preserves_parser_output():
    from originium_research_mcp.providers import openalex
    sanitized = json.loads((Path(__file__).parents[1] / OPENALEX).read_text())
    assert not guard.has_key(sanitized, guard.OPENALEX_PROSE_KEYS)
    with_prose = json.loads(json.dumps(sanitized))
    for authorship in with_prose['authorships']:
        authorship['raw_affiliation_strings'] = ['Synthetic biography never used by parser.']
        for affiliation in authorship['affiliations']:
            affiliation['raw_affiliation_string'] = 'Synthetic biography never used by parser.'
    assert openalex(sanitized) == openalex(with_prose)
    # Structured, non-prose facts stay in place.
    authorship = sanitized['authorships'][0]
    assert authorship['author']['id'] and authorship['institutions'][0]['id']
    assert authorship['affiliations'][0]['institution_ids'] == [authorship['institutions'][0]['id']]


def rewrite_openalex(root, manifest, text):
    """Replace the OpenAlex fixture and keep every hash/byte record self-consistent."""
    (root / OPENALEX).write_text(text)
    raw = (root / OPENALEX).read_bytes()
    data = json.loads((root / OBSERVATIONS).read_text())
    data['records'][1].update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
    (root / OBSERVATIONS).write_text(json.dumps(data))
    refresh_derived(root, manifest, OPENALEX)
    refresh_derived(root, manifest, OBSERVATIONS)


@pytest.mark.parametrize('text', [
    '{"authorships": [{"raw_affiliation_strings": ["Synthetic"]}]}',
    '{"authorships": [{"affiliations": [{"raw_affiliation_string": "Synthetic"}]}]}',
    '{"nested": [[{"raw_affiliation_strings": []}]]}',
], ids=['strings', 'string', 'nested'])
def test_openalex_reintroduced_raw_prose_rejected_even_when_rehashed(candidate, text):
    root, manifest = candidate
    rewrite_openalex(root, manifest, text)
    assert any(e == 'openalex raw prose affiliation must remain removed' for e in guard.validate(root, []))


def test_openalex_malformed_fixture_rejected_even_when_rehashed(candidate):
    root, manifest = candidate
    rewrite_openalex(root, manifest, '{"authorships": [')
    assert any('openalex derived fixture must be parseable' in e for e in guard.validate(root, []))


def test_openalex_current_hash_and_missing_derivation_rejected(candidate):
    root, manifest = candidate
    (root / OPENALEX).write_text('{"changed": true}\n')
    errors = guard.validate(root, [])
    assert any(e.startswith('immutable hash mismatch') for e in errors)
    assert any(e.startswith('derived current hash/bytes mismatch') for e in errors)
    # A restored fixture must still carry its source provenance and derivation.
    (root / OPENALEX).write_text('{}\n')
    data = json.loads((root / OBSERVATIONS).read_text())
    del data['records'][1]['derivation']
    (root / OBSERVATIONS).write_text(json.dumps(data))
    refresh_derived(root, manifest, OBSERVATIONS)
    assert guard.validate(root, [])


def test_host_projection_has_no_uid_global_nproc_and_target_caps_are_unchanged():
    source = (Path(__file__).parents[1] / 'scripts/check-local.sh').read_text()
    host, _, rest = source.partition("<<'TRUSTED_PROJECTION_PY'")
    _, _, target = rest.partition('\nTRUSTED_PROJECTION_PY\n')
    def limits(text):
        return [line.strip() for line in text.splitlines() if line.strip().startswith('/usr/bin/prlimit')]
    # RLIMIT_NPROC is UID-global outside the user namespace: host launcher has none.
    assert limits(host) == ['/usr/bin/prlimit --as=2147483648 --cpu=90 --nofile=256 --fsize=16777216 \\']
    assert '--kill-after=5 60' in host
    # The confined target keeps its exact original caps.
    assert limits(target) == ['/usr/bin/prlimit --as=2147483648 --cpu=90 --nproc=64 --nofile=256 --fsize=16777216 \\']
    assert '--unshare-all --unshare-user --unshare-net --unshare-pid' in target
    assert sum('--nproc' in line for line in source.splitlines() if not line.lstrip().startswith('#')) == 1


def test_projection_runs_at_most_one_git_child_at_a_time(approved_commit, projection_launcher, projection_space, monkeypatch):
    # Contained tests cannot prove the host fork cap; they prove the launcher's
    # sequential structure that the documented no-nproc bound relies on.
    root, _ = approved_commit
    original = projection_launcher.subprocess.run
    state = dict(active=0, peak=0, calls=0)

    def tracked(argv, *args, **kwargs):
        assert argv[0] == '/usr/bin/git' and not kwargs.get('shell')
        state['active'] += 1
        state['calls'] += 1
        state['peak'] = max(state['peak'], state['active'])
        try:
            return original(argv, *args, **kwargs)
        finally:
            state['active'] -= 1

    monkeypatch.setattr(projection_launcher.subprocess, 'run', tracked)
    assert projection_launcher.project_git(root, projection_space)
    assert state['calls'] > 1 and state['peak'] == 1 and state['active'] == 0
    source = (Path(__file__).parents[1] / 'scripts/check-local.sh').read_text()
    launcher = source.split('# BEGIN TRUSTED_GIT_PROJECTION\n', 1)[1].split('# END TRUSTED_GIT_PROJECTION', 1)[0]
    for forbidden in ('Popen', 'threading', 'multiprocessing', 'os.fork', 'shell=True', 'concurrent'):
        assert forbidden not in launcher


@pytest.fixture
def projection_launcher():
    # Execute the exact trusted heredoc in the sandbox, never a host-side import.
    import types
    source = (Path(__file__).parents[1] / 'scripts/check-local.sh').read_text()
    source = source.split('# BEGIN TRUSTED_GIT_PROJECTION\n', 1)[1].split('# END TRUSTED_GIT_PROJECTION', 1)[0]
    module = types.ModuleType('synthetic_projection_launcher')
    exec(compile(source, 'trusted_projection_launcher', 'exec'), module.__dict__)
    return module


@pytest.fixture
def projection_space(tmp_path):
    space = tmp_path.parent / (tmp_path.name + '-projection')
    space.mkdir()
    return space


def projected_git(projection, root, *args):
    return fixture_git(root, '--git-dir=' + str(projection / 'public.git'), *args)


def test_projection_exact_commit_without_history_hooks_or_unreachable(approved_commit, projection_launcher, projection_space):
    root, _ = approved_commit
    parent = fixture_git(root, 'rev-parse', 'HEAD').decode().strip()
    fixture_git(root, 'commit', '--allow-empty', '-qm', 'Synthetic current commit')
    current = fixture_git(root, 'rev-parse', 'HEAD').decode().strip()
    unreachable = fixture_git(root, 'hash-object', '-w', '--stdin', input=b'Synthetic unreachable blob').decode().strip()
    (root / '.git/hooks').mkdir(exist_ok=True)
    hook = root / '.git/hooks/post-checkout'
    hook.write_text('#!/bin/sh\nexit 99\n')
    hook.chmod(0o755)
    fixture_git(root, 'config', 'fixture.private', 'synthetic nonpublic config')
    assert projection_launcher.project_git(root, projection_space) == current
    target = projection_space / 'public.git'
    assert (target / 'HEAD').read_text().strip() == current
    assert projected_git(projection_space, root, 'cat-file', 'commit', current) == fixture_git(root, 'cat-file', 'commit', current)
    assert projected_git(projection_space, root, 'ls-files', '--stage', '-z') == fixture_git(root, 'ls-files', '--stage', '-z')
    for name in ('hooks', 'objects/info/alternates', 'logs', 'packed-refs'):
        assert not (target / name).exists()
    assert 'synthetic nonpublic config' not in (target / 'config').read_text()
    for missing in (parent, unreachable):
        with pytest.raises(subprocess.CalledProcessError):
            projected_git(projection_space, root, 'cat-file', '-e', missing)
    # Exact guard integration uses only the projected metadata in the scratch tree.
    import shutil
    shutil.rmtree(root / '.git')
    shutil.copytree(target, root / '.git')
    assert guard.validate(root, [], True) == []


@pytest.mark.parametrize('mutation', ['missing-index', 'missing-head', 'staged', 'restored', 'removed',
                                      'extra-index', 'unmerged', 'index-mode', 'worktree-mode',
                                      'dirty', 'extra-working', 'missing-working', 'alternates', 'metadata-symlink'])
def test_projection_rejects_actual_metadata_and_worktree_changes(approved_commit, projection_launcher, projection_space, mutation):
    root, _ = approved_commit
    readme = root / 'README.md'
    if mutation in {'missing-index', 'missing-head'}:
        (root / '.git' / ('index' if mutation == 'missing-index' else 'HEAD')).unlink()
    elif mutation in {'staged', 'restored'}:
        original = readme.read_bytes()
        readme.write_bytes(original + b'Synthetic change\n')
        fixture_git(root, 'add', 'README.md')
        if mutation == 'restored':
            readme.write_bytes(original)
    elif mutation == 'removed':
        fixture_git(root, 'update-index', '--force-remove', 'README.md')
    elif mutation == 'extra-index':
        (root / 'extra.txt').write_text('Synthetic extra file')
        fixture_git(root, 'add', 'extra.txt')
        (root / 'extra.txt').unlink()
    elif mutation == 'unmerged':
        oid = fixture_git(root, 'rev-parse', 'HEAD:README.md').decode().strip()
        fixture_git(root, 'update-index', '--index-info', input=(
            '0 ' + '0' * 40 + '\tREADME.md\n' + f'100644 {oid} 1\tREADME.md\n100644 {oid} 2\tREADME.md\n').encode())
    elif mutation == 'index-mode':
        fixture_git(root, 'update-index', '--chmod=+x', 'README.md')
    elif mutation == 'worktree-mode':
        readme.chmod(0o755)
    elif mutation == 'dirty':
        readme.write_text('Synthetic dirty bytes')
    elif mutation == 'extra-working':
        (root / 'extra.txt').write_text('Synthetic extra')
    elif mutation == 'missing-working':
        readme.unlink()
    elif mutation == 'alternates':
        (root / '.git/objects/info/alternates').write_text('/synthetic/never/read\n')
    else:
        (root / '.git/index').unlink()
        (root / '.git/index').symlink_to('/synthetic/never/read')
    with pytest.raises((ValueError, OSError)):
        projection_launcher.project_git(root, projection_space)
    assert not (projection_space / 'public.git/index').exists()


@pytest.mark.parametrize('mutation', ['extra', 'symlink', 'gitlink', 'invalid-name'])
def test_projection_rejects_head_names_and_modes_before_blob_reads(approved_commit, projection_launcher, projection_space, monkeypatch, mutation):
    root, _ = approved_commit
    if mutation in {'extra', 'invalid-name'}:
        name = 'extra.txt' if mutation == 'extra' else 'bad\nname'
        (root / name).write_text('Synthetic')
        fixture_git(root, 'add', '--', name)
    else:
        mode = '120000' if mutation == 'symlink' else '160000'
        revision = 'HEAD:README.md' if mutation == 'symlink' else 'HEAD'
        oid = fixture_git(root, 'rev-parse', revision).decode().strip()
        fixture_git(root, 'update-index', '--cacheinfo', f'{mode},{oid},README.md')
    fixture_git(root, 'commit', '-qm', 'Synthetic invalid HEAD')
    original = projection_launcher.subprocess.run
    def no_blob_reads(argv, *args, **kwargs):
        assert not ('cat-file' in argv and 'blob' in argv), 'invalid tree must reject before blob reads'
        return original(argv, *args, **kwargs)
    monkeypatch.setattr(projection_launcher.subprocess, 'run', no_blob_reads)
    with pytest.raises(ValueError):
        projection_launcher.project_git(root, projection_space)


def test_projection_clean_environment_and_bounded_objects(approved_commit, projection_launcher, projection_space, monkeypatch):
    root, _ = approved_commit
    for name in ('GIT_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM'):
        monkeypatch.setenv(name, '/synthetic/never/read')
    monkeypatch.setenv('GIT_CONFIG_COUNT', '1')
    monkeypatch.setenv('GIT_CONFIG_KEY_0', 'core.fsmonitor')
    monkeypatch.setenv('GIT_CONFIG_VALUE_0', '/synthetic/never/execute')
    assert projection_launcher.project_git(root, projection_space)
    import shutil
    shutil.rmtree(projection_space / 'public.git')
    monkeypatch.setattr(projection_launcher, 'MAX_TOTAL', 1)
    with pytest.raises(ValueError, match='byte budget'):
        projection_launcher.project_git(root, projection_space)


def test_projection_rejects_symlink_scratch(approved_commit, projection_launcher, projection_space):
    root, _ = approved_commit
    link = projection_space.parent / (projection_space.name + '-link')
    link.symlink_to(projection_space, target_is_directory=True)
    with pytest.raises(ValueError, match='symlink'):
        projection_launcher.project_git(root, link)


def test_approved_component_cannot_drop_derivation_schema(candidate):
    root, manifest = candidate
    manifest['status'] = 'RELEASE_APPROVED'
    for gate in manifest['gates'].values():
        gate.update(approved=True, evidence='SYNTHETIC FIXTURE ONLY')
    del manifest['derived_payloads']
    save(root, manifest)
    assert any('derived payload inventory' in e for e in guard.validate(root, [], True))


def test_projection_does_not_load_source_configuration(approved_commit, projection_launcher, projection_space):
    root, _ = approved_commit
    head = fixture_git(root, 'rev-parse', 'HEAD').decode().strip()
    # Even malformed source config cannot trigger includes, fsmonitor or hooks:
    # the data-only reader has a fresh config and directly reads actual index/objects.
    (root / '.git/config').write_text('[synthetic malformed configuration\n')
    assert projection_launcher.project_git(root, projection_space) == head


def test_projection_ignores_source_replacement_refs(approved_commit, projection_launcher, projection_space):
    root, _ = approved_commit
    parent = fixture_git(root, 'rev-parse', 'HEAD').decode().strip()
    fixture_git(root, 'commit', '--allow-empty', '-qm', 'Synthetic current commit')
    head = fixture_git(root, 'rev-parse', 'HEAD').decode().strip()
    commit = fixture_git(root, 'cat-file', 'commit', head)
    fixture_git(root, 'replace', head, parent)
    assert projection_launcher.project_git(root, projection_space) == head
    assert projected_git(projection_space, root, 'cat-file', 'commit', head) == commit
    assert not (projection_space / 'public.git/refs/replace').exists()


def test_projection_rejects_unborn_head(approved_uncommitted, projection_launcher, projection_space):
    root, _ = approved_uncommitted
    fixture_git(root, 'init', '-q', '--template=', '--initial-branch=fixture')
    fixture_git(root, 'add', '--all')
    with pytest.raises((OSError, ValueError)):
        projection_launcher.project_git(root, projection_space)
