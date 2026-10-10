"""Portable packaging/configuration checks; no credentials or network required."""
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def test_portable_pi_template():
    config = json.loads((ROOT / "example-client-config.json").read_text())
    assert set(config["mcpServers"]) == {"research"}
    entry = config["mcpServers"]["research"]
    assert entry["command"] == "/usr/bin/env"
    assert entry["transport"] == "stdio" and entry["lifecycle"] == "lazy"
    assert entry["args"][0] == "-i" and "-P" in entry["args"]
    assert entry["args"][-2:] == ["-m", "originium_research_mcp"]
    assert "HOME=/ABSOLUTE/PATH/TO/HOME" in entry["args"]
    assert "/ABSOLUTE/PATH/TO/research-mcp/.venv/bin/python" in entry["args"]
    assert not any(arg.startswith(("OPENALEX_API_KEY=", "RESEARCH_CONTACT_EMAIL=")) for arg in entry["args"])


def test_machine_state_is_ignored():
    patterns = set((ROOT / ".gitignore").read_text().splitlines())
    assert {".venv/", ".pip-cache/", ".local/", ".pi/", ".env", "pi-client-config.json"} <= patterns


def test_repository_documentation_links():
    for document in [*ROOT.glob("*.md"), ROOT / "integration" / "README.md"]:
        for target in re.findall(r"\]\(([^)]+)\)", document.read_text()):
            if "://" in target or target.startswith("#"):
                continue
            assert (document.parent / target.split("#", 1)[0]).exists(), (document.name, target)
