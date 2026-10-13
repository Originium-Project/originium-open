#!/usr/bin/env python3
"""Offline current-tree inventory; historical receipts confer no new approval."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

SPEC = importlib.util.spec_from_file_location("release_guard", Path(__file__).with_name("check-release.py"))
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)

# Adding a component requires both an inventory review and a runner implementation.
COMPONENTS = {"research-mcp": "release-manifest.json",
              "token-flow-demo": "projects/token-flow-demo/component-manifest.json"}


def paths(value):
    if (not isinstance(value, list) or not value
            or not all(guard.portable(p) and not guard.excluded(p) for p in value)
            or len(value) != len(set(value))
            or any(part.startswith("AGENTS") or part == "CLAUDE.md"
                   for p in value for part in p.split("/"))):
        raise ValueError("invalid, duplicate or protected inventory path")
    return set(value)


def validate(root, tracked):
    root = Path(root).absolute()
    if any(p.is_symlink() for p in (root, *root.parents)):
        return ["current root and its ancestors must not be symlinks"]
    files, errors = guard.inventory(root)
    if errors:
        return errors
    try:
        catalog = json.loads((root / "component-catalog.json").read_text())
        if (catalog["schema_version"] != 1 or catalog["purpose"] != "local-validation-only"
                or set(catalog["components"]) != set(COMPONENTS)):
            return ["unsupported current component catalog"]
        allowed = paths(catalog["root_paths"])
        if any(p.startswith("projects/") for p in allowed):
            return ["root inventory cannot authorize component paths"]
        if "component-catalog.json" not in allowed:
            return ["catalog must inventory itself"]
        directories = {p.name for p in (root / "projects").iterdir()
                       if p.is_dir() and not guard.excluded(p.name)}
        if directories != set(COMPONENTS):
            errors.append("component directories differ from catalog")
        receipts = {}
        for component, name in COMPONENTS.items():
            entry = catalog["components"][component]
            if entry["manifest"] != name or name not in files:
                return errors + [f"missing or invalid component receipt: {component}"]
            raw = (root / name).read_bytes()
            if hashlib.sha256(raw).hexdigest() != entry["sha256"]:
                return errors + [f"receipt hash mismatch: {name}"]
            receipt = json.loads(raw)
            receipts[component] = receipt
            inventory = paths(receipt["public_paths"])
            prefix = f"projects/{component}/"
            if component == "research-mcp":
                # Use only this component's paths from the frozen 44-path receipt.
                inventory = {p for p in inventory if p.startswith(prefix)}
            else:
                inventory = {prefix + p for p in inventory}
            allowed |= inventory
        errors += [f"unexpected public file: {p}" for p in sorted(files - allowed)]
        errors += [f"missing public file: {p}" for p in sorted(allowed - files)]
        for name in tracked:
            if not guard.portable(name) or guard.excluded(name) or name not in allowed:
                errors.append(f"unexpected or excluded tracked path: {name!r}")
        # Do not read payloads until the inventory has passed.
        if errors:
            return errors
        research = receipts["research-mcp"]
        for name, digest in research["immutable_imports_sha256"].items():
            if name not in allowed or not name.startswith(guard.COMPONENT):
                errors.append(f"invalid Research MCP hash path: {name}")
            elif hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
                errors.append(f"immutable hash mismatch: {name}")
        errors += guard.derived_errors(root, research, files)
        errors += guard.licensed_candidate_errors(root, research, files, allowed)
        demo = receipts["token-flow-demo"]
        if set(demo["retained_files"]) != paths(demo["public_paths"]) - {"component-manifest.json"}:
            errors.append("demo retained hash inventory mismatch")
        else:
            for name, entry in demo["retained_files"].items():
                raw = (root / "projects/token-flow-demo" / name).read_bytes()
                if hashlib.sha256(raw).hexdigest() != entry["sha256"] or len(raw) != entry["bytes"]:
                    errors.append(f"demo hash mismatch: {name}")
        errors += guard.doclinks(root, files)
    except (OSError, KeyError, TypeError, ValueError, AttributeError):
        errors.append("invalid or unreadable current component catalog/receipt")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).absolute().parents[1])
    parser.add_argument("--tracked-inventory", type=Path)
    args = parser.parse_args()
    try:
        if args.tracked_inventory:
            path = args.tracked_inventory.absolute()
            if path.is_symlink() or path.parent != Path("/scratch") or not path.is_file():
                raise ValueError("tracked inventory must be a regular direct /scratch file")
            raw = path.read_bytes()
            if raw and not raw.endswith(b"\0"):
                raise ValueError("tracked inventory must be NUL terminated")
            tracked = raw.decode("utf-8").split("\0")[:-1] if raw else []
        else:
            tracked = guard.tracked_names(args.root)
        errors = validate(args.root, tracked)
    except (OSError, ValueError, guard.subprocess.CalledProcessError) as exc:
        print(f"current inventory unavailable: {type(exc).__name__}", file=sys.stderr)
        return 1
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("current component inventory OK; publication authorization is separate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
