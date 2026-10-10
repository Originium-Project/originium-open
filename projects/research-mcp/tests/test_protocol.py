import asyncio
import os
from pathlib import Path
import sys

from mcp import Client, StdioServerParameters

from originium_research_mcp.server import build_server


def test_in_memory_discovery_and_call():
    async def check():
        async with Client(build_server()) as client:
            tools = await client.list_tools()
            names = {tool.name for tool in tools.tools}
            assert names == {"search_papers", "lookup_paper", "find_access", "edinburgh_access", "provider_status"}
            result = await client.call_tool("edinburgh_access", {"title": "A & B"})
            assert not result.is_error
            assert result.structured_content["entitlement"] == "unknown"
    asyncio.run(check())


def test_real_stdio_local_only(tmp_path):
    source = str(Path(__file__).resolve().parents[1] / "src")
    env = {"PYTHONPATH": source, "RESEARCH_MCP_STATE_DIR": str(tmp_path), "PATH": os.environ.get("PATH", "")}
    params = StdioServerParameters(command=sys.executable, args=["-m", "originium_research_mcp"], env=env)
    async def check():
        async with Client(params) as client:
            result = await client.call_tool("provider_status", {})
            assert not result.is_error
            assert result.structured_content["edinburgh"]["entitlement"] == "unknown"
    asyncio.run(check())
