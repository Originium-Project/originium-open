#!/usr/bin/env python3
"""Structural draft/candidate inventory guard; stdlib only, no publication actions.

Excluded state is never opened. Git supplies names only, including ignored tracked
files, in LOCAL_DRAFT. Approved mode also checks the exact HEAD/index/public blobs.
In containment, pass the launcher's NUL-separated tracked-name inventory.
This is a review guard, not a secret scanner or approval authority.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tomllib
from urllib.parse import unquote

SOURCE_REVISION = "4aefd8ae0ab6460a671a0ce774fc0abc585ce9a0"
COMPONENT = "projects/research-mcp/"
DERIVED_SOURCES = {
    COMPONENT + "pyproject.toml": ("115b536b1d4dfd9d8aa8d9c421ca74572c9a92d1719ca0919da9fff7b259dcd4", 493),
    COMPONENT + "reference_samples/crossref.json": ("4d4ba5b2ba5965ac378a3550ec412534bb895e0d80184e11e80a8553cdcc8e77", 1803),
    COMPONENT + "reference_samples/OBSERVATIONS.json": ("f32b6f99f0a1388601f21b9e79cfd9b12dc1181e0519a3453305d0f5300047a4", 1319),
    COMPONENT + "reference_samples/openalex.json": ("d0640ac7b1e10e3cc668691658216170615aac53f15084df3e68976e95596f40", 5490),
}
# Exact nonessential raw prose fields removed from each provider fixture.
REMOVED_FIELDS = {
    "crossref": ["message.author[*].affiliation"],
    "openalex": ["authorships[*].raw_affiliation_strings",
                 "authorships[*].affiliations[*].raw_affiliation_string"],
}
OPENALEX_PROSE_KEYS = {"raw_affiliation_strings", "raw_affiliation_string"}
# Standard SPDX MIT full text with the user-declared holder/year.
MIT_LICENSE = '''MIT License

Copyright (c) 2026 Originium Project contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
'''
GATES = {
    "final_publication", "rights", "project_license", "copyright_owner",
    "dependency_obligations", "source_version", "source_of_truth", "hosting",
    "owner_design", "privacy_review", "contained_tests",
}
STATE_DIRS = {
    ".git", ".local", ".review-inputs", ".venv", "__pycache__",
    ".pytest_cache", ".pip-cache", ".cache", ".node-cache", ".pi",
    ".claude", ".scratch", "operator-state", "dist", "build",
}
STATE_FILES = {".env", ".envrc", "pi-client-config.json", ".coverage"}


def excluded(path):
    parts = PurePosixPath(path).parts
    return any(
        p in STATE_DIRS or p in STATE_FILES or p.startswith((".env.", ".test-scratch-", ".gitleaks-report"))
        or p.endswith((".egg-info", ".pyc", ".pyo", ".log"))
        for p in parts
    )


def portable(path):
    return (isinstance(path, str) and bool(path) and "\\" not in path
            and not any(c in path for c in "\x00\r\n")
            and not PurePosixPath(path).is_absolute()
            and all(p not in {"", ".", ".."} for p in path.split("/")))


def inventory(root):
    """lstat before recursion: never follow symlinks or open excluded state."""
    files, errors = set(), []
    def walk(directory):
        for entry in sorted(os.scandir(directory), key=lambda e: e.name):
            rel = Path(entry.path).relative_to(root).as_posix()
            if excluded(rel):
                continue
            mode = entry.stat(follow_symlinks=False).st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                errors.append(f"symlink or special public path: {rel}")
            elif stat.S_ISDIR(mode):
                walk(Path(entry.path))
            else:
                files.add(rel)
    walk(root)
    return files, errors


def tracked_names(root):
    result = subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "ls-files", "-z", "--cached"],
        cwd=root, capture_output=True, check=True,
        env={"PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"},
    )
    return result.stdout.decode("utf-8").split("\0")[:-1]


def approved_tree_errors(root, allowed):
    """Read only this candidate's HEAD/index; never inspect history or private blobs."""
    def git(*args):
        return subprocess.run(
            ["/usr/bin/git", "--git-dir=" + str(root / ".git"),
             "--work-tree=" + str(root), "-c", "core.fsmonitor=false", *args],
            cwd=root, capture_output=True, check=True,
            env={"PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1",
                 "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_OPTIONAL_LOCKS": "0",
                 "GIT_NO_REPLACE_OBJECTS": "1"},
        ).stdout

    def records(raw):
        if raw and not raw.endswith(b"\0"):
            raise ValueError("unterminated Git inventory")
        return raw.decode("utf-8").split("\0")[:-1] if raw else []

    def object_id(value):
        return re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", value) is not None

    try:
        head = git("rev-parse", "--verify", "HEAD^{commit}").decode("ascii").strip()
        if not object_id(head):
            raise ValueError("invalid concrete HEAD")
        tree, errors = {}, []
        # Validate the complete name/mode inventory BEFORE reading any blobs.
        for record in records(git("ls-tree", "-r", "-z", "--full-tree", head)):
            metadata, name = record.split("\t", 1)
            mode, kind, oid = metadata.split(" ")
            if not portable(name) or excluded(name) or name not in allowed:
                errors.append(f"unexpected or excluded committed path: {name!r}")
            if mode not in {"100644", "100755"} or kind != "blob" or not object_id(oid):
                errors.append(f"nonregular or invalid committed path: {name!r}")
            if name in tree:
                errors.append(f"duplicate committed path: {name!r}")
            tree[name] = (mode, oid)
        if set(tree) != allowed:
            errors.append("committed HEAD path inventory must equal public_paths")
        if errors:
            return errors
        index = {}
        for record in records(git("ls-files", "--stage", "-z", "--cached")):
            metadata, name = record.split("\t", 1)
            mode, oid, stage = metadata.split(" ")
            if not portable(name) or excluded(name) or name not in allowed:
                errors.append(f"unexpected or excluded index path: {name!r}")
            if stage != "0" or name in index:
                errors.append(f"unmerged or duplicate index path: {name!r}")
            index[name] = (mode, oid)
        if index != tree:
            errors.append("Git index must match committed HEAD modes and blobs")
        if errors:
            return errors
        for name, (mode, oid) in sorted(tree.items()):
            path = root / name
            file_mode = path.lstat().st_mode
            if not stat.S_ISREG(file_mode):
                errors.append(f"nonregular approved working path: {name}")
                continue
            executable = bool(file_mode & 0o111)
            if executable != (mode == "100755") or (executable and not file_mode & stat.S_IXUSR):
                errors.append(f"working-tree executable mode differs from HEAD: {name}")
            if path.read_bytes() != git("cat-file", "blob", oid):
                errors.append(f"working-tree bytes differ from HEAD: {name}")
        return errors
    except (OSError, ValueError, subprocess.CalledProcessError):
        return ["approved release requires a readable concrete HEAD commit, tree and index"]


def immutable_path(path):
    prefix = "projects/research-mcp/"
    if not path.startswith(prefix):
        return False
    sub = path[len(prefix):]
    return sub.startswith(("src/", "tests/", "reference_samples/")) or sub in {
        "requirements.lock", "pyproject.toml", "example-client-config.json",
        "integration/pi-connection-check.mjs",
    }


def doclinks(root, files):
    errors = []
    for rel in sorted(files):
        if not rel.endswith(".md"):
            continue
        text = (root / rel).read_text(encoding="utf-8")
        # Inline Markdown links; reference definitions checked separately.
        targets = re.findall(r"\]\(([^)]+)\)", text)
        targets += re.findall(r"(?m)^\s*\[[^\]]+\]:\s*(\S+)", text)
        for target in targets:
            target = target.strip().strip("<>")
            if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", target) or target.startswith("#"):
                continue
            path = unquote(target.split("#", 1)[0])
            dest = Path(os.path.normpath(str(Path(rel).parent / path)))
            name = dest.as_posix()
            # Inventory is already free of symlinks; do not probe private paths.
            if not portable(name) or excluded(name) or not (
                name in files or any(p.startswith(name.rstrip("/") + "/") for p in files)
            ):
                errors.append(f"broken or excluded relative doclink: {rel} -> {target}")
    return errors


def derived_errors(root, manifest, files):
    """Validate narrowly authorized derivations, not legal/security sufficiency."""
    errors = []
    derived = manifest.get("derived_payloads")
    if not isinstance(derived, dict) or set(derived) != set(DERIVED_SOURCES):
        return ["derived payload inventory must contain exactly the four authorized paths"]
    fields = {"source_sha256", "source_bytes", "current_sha256", "current_bytes", "reason"}
    for name, (source_hash, source_bytes) in DERIVED_SOURCES.items():
        entry = derived[name]
        if not isinstance(entry, dict) or set(entry) != fields:
            errors.append(f"invalid derived metadata schema: {name}")
            continue
        if (entry["source_sha256"] != source_hash or type(entry["source_bytes"]) is not int
                or entry["source_bytes"] != source_bytes):
            errors.append(f"derived source provenance mismatch: {name}")
        if (not isinstance(entry["reason"], str) or entry["reason"].strip() in {"", "PENDING"}
                or type(entry["current_bytes"]) is not int or entry["current_bytes"] <= 0
                or not isinstance(entry["current_sha256"], str)
                or not re.fullmatch(r"[0-9a-f]{64}", entry["current_sha256"])):
            errors.append(f"invalid derived metadata values: {name}")
        if name not in files:
            errors.append(f"missing derived payload: {name}")
            continue
        raw = (root / name).read_bytes()
        if (entry["current_sha256"] != hashlib.sha256(raw).hexdigest()
                or entry["current_bytes"] != len(raw)
                or entry["current_sha256"] != manifest["immutable_imports_sha256"].get(name)):
            errors.append(f"derived current hash/bytes mismatch: {name}")
    if errors:
        return errors
    observations = json.loads((root / (COMPONENT + "reference_samples/OBSERVATIONS.json")).read_text())
    records = observations["records"]
    if not isinstance(records, list) or len(records) != 3:
        return ["invalid observation inventory"]
    expected = {"crossref": ("crossref.json", "2026-09-28T00:24:22.882280+00:00"),
                "openalex": ("openalex.json", "2026-09-28T00:24:22.882625+00:00"),
                "arxiv": ("arxiv.xml", "2026-09-28T00:24:22.882884+00:00")}
    seen = set()
    for record in records:
        provider = record["provider"]
        if provider not in expected or provider in seen:
            errors.append("invalid observation provider")
            continue
        seen.add(provider)
        filename, timestamp = expected[provider]
        path = COMPONENT + "reference_samples/" + filename
        if path not in files:
            errors.append("missing observation fixture")
            continue
        raw = (root / path).read_bytes()
        if (record["file"] != filename or record["observed_at"] != timestamp
                or type(record["http_status"]) is not int or record["http_status"] != 200
                or record["status"] != "retrieved_public_sample"
                or type(record["bytes"]) is not int or record["bytes"] != len(raw)
                or record["sha256"] != hashlib.sha256(raw).hexdigest()):
            errors.append("observation history or current fixture hash/bytes mismatch")
        if provider in REMOVED_FIELDS:
            source_hash, source_bytes = DERIVED_SOURCES[path]
            derivation = record["derivation"]
            if (record["source_sha256"] != source_hash or record["source_bytes"] != source_bytes
                    or type(record["source_bytes"]) is not int
                    or set(derivation) != {"removed_fields", "reason", "no_new_query"}
                    or derivation["removed_fields"] != REMOVED_FIELDS[provider]
                    or derivation["no_new_query"] is not True
                    or not isinstance(derivation["reason"], str) or not derivation["reason"].strip()):
                errors.append(f"{provider} derivation provenance mismatch")
            try:
                fixture = json.loads(raw)
                if provider == "crossref":
                    leftover = any("affiliation" in author for author in fixture["message"]["author"])
                else:
                    leftover = has_key(fixture, OPENALEX_PROSE_KEYS)
            except (ValueError, KeyError, TypeError):
                errors.append(f"{provider} derived fixture must be parseable JSON")
            else:
                if leftover:
                    errors.append(f"{provider} raw prose affiliation must remain removed")
        elif "derivation" in record or "source_sha256" in record:
            errors.append(f"unexpected derivation provenance: {provider}")
    return errors


def has_key(value, names):
    """True when any dict at any depth carries one of the named keys."""
    if isinstance(value, dict):
        return bool(names & value.keys()) or any(has_key(v, names) for v in value.values())
    return isinstance(value, list) and any(has_key(v, names) for v in value)


def licensed_candidate_errors(root, manifest, files, allowed):
    errors = []
    if manifest["decisions"] != {"project_license": "MIT", "copyright_owner": "Originium Project contributors",
                                  "source_version": SOURCE_REVISION}:
        errors.append("candidate requires resolved MIT/copyright/source decisions")
    for name in ("LICENSE", COMPONENT + "LICENSE"):
        if name not in files or name not in allowed or (root / name).read_bytes() != MIT_LICENSE.encode():
            errors.append(f"candidate requires exact declared MIT LICENSE: {name}")
    project = COMPONENT + "pyproject.toml"
    if project not in files:
        errors.append("candidate requires component license metadata")
    else:
        metadata = tomllib.loads((root / project).read_text())["project"]
        if metadata.get("license") != "MIT" or metadata.get("license-files") != ["LICENSE"]:
            errors.append("candidate requires PEP 639 MIT license metadata")
    if len(manifest["immutable_imports_sha256"]) != 22:
        errors.append("candidate requires 22 frozen payloads, including four derivations")
    return errors


def validate(root, tracked, require_approved=False):
    root = Path(root).absolute()
    if any(p.is_symlink() for p in (root, *root.parents)):
        return ["candidate root and its ancestors must not be symlinks"]
    files, errors = inventory(root)
    if errors:
        return errors
    manifest_path = "release-manifest.json"
    if manifest_path not in files:
        return ["missing regular release-manifest.json"]
    try:
        manifest = json.loads((root / manifest_path).read_text())
        if type(manifest.get("schema_version")) is not int or manifest["schema_version"] != 1:
            # Legacy synthetic drafts omit the version; real manifests declare it.
            if "schema_version" in manifest:
                errors.append("unsupported manifest schema version")
        allowed = manifest["public_paths"]
        if not isinstance(allowed, list) or not all(portable(p) for p in allowed):
            return ["invalid public path allowlist"]
        if len(allowed) != len(set(allowed)) or any(excluded(p) for p in allowed):
            return ["duplicate or excluded public path"]
        allowed = set(allowed)
        for p in allowed:
            if any(part.startswith("AGENTS") or part == "CLAUDE.md" for part in PurePosixPath(p).parts):
                errors.append(f"protected instruction path: {p}")
        errors += [f"unexpected public file: {p}" for p in sorted(files - allowed)]
        errors += [f"missing public file: {p}" for p in sorted(allowed - files)]
        # Name-only validation catches forced tracked private state without reading it.
        for p in tracked:
            if not portable(p) or p not in allowed or excluded(p):
                errors.append(f"unexpected or excluded tracked path: {p!r}")
        if manifest["source_revision"] != SOURCE_REVISION:
            errors.append("unexpected source revision")
        imports = manifest["immutable_imports_sha256"]
        required = {p for p in allowed if immutable_path(p)}
        if not required or set(imports) != required:
            errors.append("immutable hash inventory does not match required payload")
        for p, digest in imports.items():
            if p not in files or p not in required:
                errors.append(f"missing or invalid immutable import: {p}")
                continue
            if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
                errors.append(f"invalid SHA256: {p}")
            elif hashlib.sha256((root / p).read_bytes()).hexdigest() != digest:
                errors.append(f"immutable hash mismatch: {p}")
        gates = manifest["gates"]
        if set(gates) != GATES:
            errors.append("missing or unknown release gates")
        for name, gate in gates.items():
            if (not isinstance(gate, dict) or set(gate) != {"approved", "evidence"}
                    or type(gate.get("approved")) is not bool):
                errors.append(f"invalid gate: {name}")
                continue
            evidence = gate.get("evidence")
            if gate["approved"]:
                if not isinstance(evidence, str) or evidence.strip() in {"", "PENDING"}:
                    errors.append(f"approved gate lacks evidence: {name}")
            elif evidence != "PENDING":
                errors.append(f"pending gate inconsistent evidence: {name}")
        approved = set(gates) == GATES and all(g.get("approved") is True for g in gates.values())
        status = manifest["status"]
        decisions = manifest["decisions"]
        if (status == "RELEASE_CANDIDATE" or "derived_payloads" in manifest
                or status == "RELEASE_APPROVED" and COMPONENT + "pyproject.toml" in allowed):
            errors += derived_errors(root, manifest, files & allowed)
            errors += licensed_candidate_errors(root, manifest, files & allowed, allowed)
        if set(decisions) != {"project_license", "copyright_owner", "source_version"}:
            errors.append("missing or unknown licensing/owner/source-version decisions")
        if status == "LOCAL_DRAFT":
            if any(g.get("approved") is not False for g in gates.values()):
                errors.append("LOCAL_DRAFT gates must remain pending")
            if any(v != "PENDING" for v in decisions.values()) or "LICENSE" in files:
                errors.append("LOCAL_DRAFT licensing/owner/source-version must remain PENDING without LICENSE")
            for doc in ("README.md", "LICENSING.md"):
                if doc not in files or "LOCAL DRAFT" not in (root / doc).read_text():
                    errors.append("draft must be clearly labeled with pending licensing")
            if "LICENSING.md" not in files or "PENDING" not in (root / "LICENSING.md").read_text():
                errors.append("draft must declare pending licensing")
        elif status == "RELEASE_CANDIDATE":
            if manifest.get("schema_version") != 1:
                errors.append("candidate requires manifest schema version 1")
            for name in decisions:
                if gates.get(name, {}).get("approved") is not True:
                    errors.append(f"candidate decision lacks corresponding gate evidence: {name}")
        elif status == "RELEASE_APPROVED":
            if not approved or any(not isinstance(v, str) or v.strip() in {"", "PENDING"} for v in decisions.values()):
                errors.append("release status requires all approvals and decisions")
            if "LICENSE" not in allowed or "LICENSE" not in files or not (root / "LICENSE").read_text().strip():
                errors.append("release requires reviewed nonempty LICENSE in allowlist")
        else:
            errors.append("unknown candidate status")
        if require_approved and (status != "RELEASE_APPROVED" or not approved):
            errors.append("publication blocked: approvals, rights, licensing and decisions pending")
        errors += doclinks(root, files & allowed)
        if status == "RELEASE_APPROVED" and not errors:
            errors += approved_tree_errors(root, allowed)
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        errors.append(f"invalid release manifest: {type(exc).__name__}")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).absolute().parents[1])
    parser.add_argument("--tracked-inventory", type=Path, help="trusted launcher NUL-separated Git path inventory")
    parser.add_argument("--require-approved", action="store_true")
    args = parser.parse_args()
    try:
        if args.tracked_inventory:
            # Only scratch is accepted; this option cannot open excluded input state.
            path = args.tracked_inventory.absolute()
            if path.is_symlink() or path.parent != Path("/scratch") or not path.is_file():
                raise ValueError("tracked inventory must be a regular direct /scratch file")
            raw = path.read_bytes()
            if raw and not raw.endswith(b"\0"):
                raise ValueError("tracked inventory must be NUL terminated")
            tracked = raw.decode("utf-8").split("\0")[:-1] if raw else []
        else:
            tracked = tracked_names(args.root)
        errors = validate(args.root, tracked, args.require_approved)
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"release guard could not inspect candidate: {type(exc).__name__}", file=sys.stderr)
        return 1
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print("structural inventory OK; approvals are not inferred, secrets are not proven absent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
