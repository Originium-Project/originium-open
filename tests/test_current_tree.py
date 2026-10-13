"""Current inventory checks never grant publication approval."""
import importlib.util
import json
from pathlib import Path
import shutil

import pytest

ROOT = Path(__file__).parents[1]


def checker():
    spec = importlib.util.spec_from_file_location("current_tree", ROOT / "scripts/check-current.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def current(tmp_path):
    # Copy public files only; never traverse local state or Git metadata.
    spec = importlib.util.spec_from_file_location("guard", ROOT / "scripts/check-release.py")
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    files, errors = guard.inventory(ROOT)
    assert not errors
    for name in files:
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    return tmp_path


def test_current_two_component_tree_passes():
    assert checker().validate(ROOT, []) == []


@pytest.mark.parametrize("name", ["projects/unlisted/file.txt", "projects/token-flow-demo/extra.js",
                                  "projects/research-mcp/extra.py", "extra.txt"])
def test_current_rejects_unlisted_files(current, name):
    path = current / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("unexpected")
    assert any("unexpected public file" in error for error in checker().validate(current, []))


def test_current_rejects_empty_unlisted_component(current):
    (current / "projects/unlisted").mkdir()
    assert any("component directories" in error for error in checker().validate(current, []))


@pytest.mark.parametrize("name", ["projects/token-flow-demo/app.js",
                                  "projects/research-mcp/src/originium_research_mcp/server.py"])
def test_current_rejects_modified_payload(current, name):
    with (current / name).open("a") as stream:
        stream.write("\n# changed\n")
    assert any("hash mismatch" in error for error in checker().validate(current, []))


@pytest.mark.parametrize("name", ["release-manifest.json", "projects/token-flow-demo/component-manifest.json"])
def test_current_rejects_modified_inventory(current, name):
    path = current / name
    manifest = json.loads(path.read_text())
    manifest["public_paths"].pop()
    path.write_text(json.dumps(manifest))
    assert any("receipt hash mismatch" in error for error in checker().validate(current, []))


def test_current_rejects_missing_file(current):
    (current / "projects/token-flow-demo/app.js").unlink()
    assert any("missing public file" in error for error in checker().validate(current, []))


def test_current_rejects_tracked_private_name_without_read(current):
    assert any("tracked path" in error for error in checker().validate(current, [".env"]))


def test_current_does_not_call_historical_approval_check(monkeypatch):
    module = checker()
    def forbidden(*args):
        raise AssertionError("current checks must not consult or grant publication approval")
    monkeypatch.setattr(module.guard, "approved_tree_errors", forbidden)
    assert module.validate(ROOT, []) == []


def test_historical_guard_still_rejects_expanded_tree():
    module = checker()
    errors = module.guard.validate(ROOT, [], require_approved=True)
    assert any("unexpected public file: projects/token-flow-demo/" in error for error in errors)
    receipt = json.loads((ROOT / "release-manifest.json").read_text())
    assert len(receipt["public_paths"]) == 44


@pytest.mark.parametrize("mutation", ["duplicate", "traversal", "missing-component"])
def test_current_rejects_invalid_catalog(current, mutation):
    path = current / "component-catalog.json"
    catalog = json.loads(path.read_text())
    if mutation == "duplicate":
        catalog["root_paths"].append(catalog["root_paths"][0])
    elif mutation == "traversal":
        catalog["root_paths"].append("../outside")
    else:
        del catalog["components"]["token-flow-demo"]
    path.write_text(json.dumps(catalog))
    assert checker().validate(current, [])
