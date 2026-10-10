"""Parent-added contract/regression checks; all provider IO is mocked."""
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path

import httpx2 as httpx
from mcp import Client
import pytest

from originium_research_mcp.identifiers import doi, doi_url, literal_arxiv_query, safe_link
from originium_research_mcp.library import HELP, RESOURCES_PLUS
from originium_research_mcp.providers import arxiv, crossref, openalex
from originium_research_mcp.server import build_server
from originium_research_mcp.service import ResearchService
from originium_research_mcp.transport import Transport, TransportError, decode_json

SAMPLES = Path(__file__).resolve().parents[1] / "reference_samples"
FEED = b'''<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry>
<id>http://arxiv.org/abs/hep-th/9901001v2</id><title>Error estimates for a model</title>
<published>1999-01-01T00:00:00Z</published><updated>1999-02-02T00:00:00Z</updated>
<arxiv:doi>10.1234/example</arxiv:doi></entry></feed>'''


def run(coro):
    return asyncio.run(coro)


def test_doi_reserved_suffix_roundtrip():
    for ident in ("10.1234/a?b#c", "10.1234/a%2fb", "10.1234/a;b(1)"):
        url = doi_url(ident)
        assert doi(url) == ident
        assert "?" not in url and "#" not in url
        assert crossref({"DOI": ident}).links[0]["url"] == url


@pytest.mark.parametrize("url", ["http://127.1/a", "http://2130706433/a", "http://0x7f.0.0.1/a",
                                "https://example.org\\@localhost/", "https://internal/a", "https://a.local/x"])
def test_ambiguous_local_links_refused(url):
    assert safe_link(url) is None


@pytest.mark.parametrize("url", ["http://%31%32%37.0.0.1/", "http://127。0.0.1/"])
def test_encoded_local_links_refused(url):
    assert safe_link(url) is None


def test_legacy_version_dates_and_error_title():
    p = arxiv(FEED)[0]
    assert p.arxiv_id == "hep-th/9901001v2"
    assert p.version == "v2" and p.publication_type == "preprint"
    assert p.published.startswith("1999-01-01") and p.updated.startswith("1999-02-02")


def test_literal_arxiv_grammar():
    query = literal_arxiv_query('cat OR ti:dog "AND" (fish)')
    assert query == 'all:"cat" AND all:"OR" AND all:"ti" AND all:"dog" AND all:"AND" AND all:"fish"'
    with pytest.raises(ValueError):
        literal_arxiv_query("!!!")


def test_oa_license_unknowns_and_truncation():
    p = openalex({"id": "https://openalex.org/W1", "best_oa_location": {
        "pdf_url": "https://repository.example/p.pdf", "is_oa": True, "version": "acceptedVersion", "license": "cc-by"}})
    assert p.links[0]["license"] == "cc-by"
    assert p.links[-1]["license"] is None
    p = crossref({"DOI": "10.1234/x", "author": [{"family": "A"}] * 31,
                  "published-print": {"date-parts": [[2020, 99, 99]]}})
    assert len(p.authors) == 30 and p.warnings == ["authors_truncated"]
    assert p.published_print is None


@pytest.mark.parametrize("header,expected", [("nan", 60), ("inf", 60), ("-1", 1), ("1.2", 2), ("86400", 86400),
                                             ("Wed, 01 Jan 2025 00:01:00 GMT", 60), ("garbage", 60)])
def test_retry_after_parsing(header, expected):
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    t = Transport(client=client, wall=lambda: datetime(2025, 1, 1, tzinfo=timezone.utc))
    assert t._retry_after(header) == expected
    run(client.aclose())


def test_cooldown_no_request_no_sleep_and_cache_available():
    requests, sleeps, clock = [], [], [0.0]
    def handler(req):
        requests.append(req)
        if "cached" in str(req.url):
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(429, headers={"Retry-After": "86400"}, text="dummy-secret")
    async def sleep(delay):
        sleeps.append(delay)
        clock[0] += delay
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            t = Transport(client=client, now=lambda: clock[0], sleep=sleep)
            await t.get("crossref", "/works/cached")
            clock[0] = 2
            for _ in range(2):
                with pytest.raises(TransportError) as exc:
                    await t.get("crossref", "/works")
                assert exc.value.code == "rate_limited" and exc.value.retry_after == 86400
                assert "dummy-secret" not in str(exc.value)
            assert (await t.get("crossref", "/works/cached"))[2]
            assert len(requests) == 2 and sleeps == []
    run(check())


def test_cache_ttl_capacity_and_arxiv_pacing():
    clock, requests, active, maximum = [0.0], [], [0], [0]
    async def sleep(delay):
        clock[0] += delay
        await asyncio.sleep(0)
    async def handler(req):
        active[0] += 1
        maximum[0] = max(maximum[0], active[0])
        requests.append(clock[0])
        await asyncio.sleep(0)
        active[0] -= 1
        return httpx.Response(200, content=b"ok")
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            t = Transport(client=client, now=lambda: clock[0], sleep=sleep)
            await asyncio.gather(*(t.get("arxiv", "/api/query", {"id_list": str(n)}) for n in range(3)))
            assert requests == [0, 3, 6] and maximum[0] == 1
            first = await t.get("arxiv", "/api/query", {"id_list": "0"})
            assert first[2]
            clock[0] = 86401
            assert not (await t.get("arxiv", "/api/query", {"id_list": "0"}))[2]
            for n in range(130):
                await t.get("crossref", "/works", {"query": str(n)})
            assert len(t.cache) == 128 and t.cache_bytes == 256
    run(check())


def test_timeouts_and_unexpected_content_are_safe():
    async def check():
        def timeout(req):
            raise httpx.ReadTimeout("dummy-secret", request=req)
        async with httpx.AsyncClient(transport=httpx.MockTransport(timeout)) as client:
            with pytest.raises(TransportError) as exc:
                await Transport(client=client).get("openalex", "/works")
            assert exc.value.code == "timeout" and "dummy-secret" not in str(exc.value)
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(200, headers={"Content-Encoding": "br"}))) as client:
            with pytest.raises(TransportError) as exc:
                await Transport(client=client).get("arxiv", "/api/query")
            assert exc.value.code == "unsupported_encoding"
        with pytest.raises(TransportError):
            decode_json(b"[not valid JSON")
        # Decoder recursion limits differ between Python versions; never leak one.
        try:
            assert isinstance(decode_json(b"[" * 2000 + b"]" * 2000), list)
        except TransportError as exc:
            assert exc.code == "malformed_content"
    run(check())


def test_lookup_latest_explicit_legacy_and_not_found():
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=FEED))) as client:
            s = ResearchService(Transport(client=client), api_key="", contact_email="")
            s.transport.sleep = lambda _: asyncio.sleep(0)
            latest = await s.lookup_paper("hep-th/9901001")
            assert latest["records"][0]["arxiv_id"] == "hep-th/9901001v2"
            wrong = await s.lookup_paper("hep-th/9901001v1")
            assert wrong["status"] == "error" and wrong["errors"][0]["code"] == "not_found"
            exact = await s.lookup_paper("hep-th/9901001v2")
            assert exact["records"][0]["version"] == "v2"
    run(check())


def test_malformed_one_provider_keeps_others():
    def handler(req):
        if req.url.host == "api.crossref.org":
            return httpx.Response(200, json={"message": {"items": [{"DOI": "10.1234/x", "author": {"bad": 1}}]}})
        return httpx.Response(200, json={"results": [{"id": "https://openalex.org/W1"}]})
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            s = ResearchService(Transport(client=client), api_key="", contact_email="")
            result = await s.search_papers("test", ["crossref", "openalex"])
            assert result["status"] == "partial" and result["errors"][0]["code"] == "malformed_content"
            assert result["records"][0]["source"] == "openalex"
    run(check())


def test_actual_public_samples_hashes_and_full_mcp_path():
    observations = json.loads((SAMPLES / "OBSERVATIONS.json").read_text())
    for record in observations["records"]:
        assert record["http_status"] == 200
        assert hashlib.sha256((SAMPLES / record["file"]).read_bytes()).hexdigest() == record["sha256"]
    requests = []
    def handler(req):
        requests.append(req)
        if req.url.host == "api.crossref.org":
            return httpx.Response(200, content=(SAMPLES / "crossref.json").read_bytes())
        if req.url.host == "api.openalex.org":
            return httpx.Response(200, content=(SAMPLES / "openalex.json").read_bytes())
        if req.url.host == "export.arxiv.org":
            return httpx.Response(200, content=(SAMPLES / "arxiv.xml").read_bytes())
        raise AssertionError("unapproved origin")
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            s = ResearchService(Transport(client=http), api_key="", contact_email="")
            async with Client(build_server(s)) as client:
                result = await client.call_tool("find_access", {"doi": "10.2469/faj.v58.n4.2453"})
                data = result.structured_content
                assert not result.is_error and data["status"] == "ok"
                assert len(data["records"]) == 2
                assert data["records"][0]["group_key"] == data["records"][1]["group_key"]
                assert data["edinburgh"]["entitlement"] == "unknown"
                assert data["edinburgh"]["library_help_url"] == HELP
                assert data["edinburgh"]["resources_plus_url"] == RESOURCES_PLUS
                assert all(link["retrieved_at"] and "license" in link for link in data["links"])
                before = len(requests)
                await client.call_tool("edinburgh_access", {"title": "A & B"})
                assert len(requests) == before
                result = await client.call_tool("lookup_paper", {"identifier": "1706.03762"})
                assert result.structured_content["records"][0]["arxiv_id"] == "1706.03762v7"
                assert result.structured_content["records"][0]["updated"]
    run(check())


def test_mcp_annotations_schemas_and_lifecycle():
    async def check():
        s = ResearchService(api_key="dummy-secret", contact_email="dummy@example.org")
        async with Client(build_server(s)) as client:
            tools = (await client.list_tools()).tools
            for tool in tools:
                assert tool.annotations.read_only_hint is True
                assert tool.annotations.destructive_hint is False
                assert tool.output_schema is not None
            search = next(t for t in tools if t.name == "search_papers")
            assert search.input_schema["properties"]["limit"]["maximum"] == 10
            assert search.input_schema["properties"]["query"]["maxLength"] == 300
            result = await client.call_tool("provider_status", {})
            data = result.structured_content
            assert data["openalex_api_key_configured"]
            assert "dummy-secret" not in json.dumps(data) and "dummy@example.org" not in json.dumps(data)
        assert s.transport.client.is_closed
    run(check())


def test_single_instance_symlink_and_reacquisition(tmp_path, monkeypatch):
    from originium_research_mcp.__main__ import _lock_instance
    monkeypatch.setenv("RESEARCH_MCP_STATE_DIR", str(tmp_path))
    fd = _lock_instance()
    try:
        with pytest.raises(RuntimeError, match="Another"):
            _lock_instance()
    finally:
        os.close(fd)
    again = _lock_instance()
    os.close(again)
    lock = tmp_path / "instance.lock"
    lock.unlink()
    sentinel = tmp_path / "sentinel"
    sentinel.write_text("unchanged")
    lock.symlink_to(sentinel)
    with pytest.raises(OSError):
        _lock_instance()
    assert sentinel.read_text() == "unchanged"


def test_arxiv_related_journal_link_not_labelled_preprint():
    links = (b'<link title="doi" rel="related" href="https://doi.org/10.1234/example"/>'
             b'<link title="pdf" href="http://arxiv.org/pdf/hep-th/9901001"/>'
             b'<link rel="related" href="https://arxiv.org/abs/2401.12345v3"/>')
    p = arxiv(FEED.replace(b"</entry>", links + b"</entry>"))[0]
    journal = next(link for link in p.links if "doi.org" in link["url"])
    assert journal["kind"] == "related_reference" and journal["version"] == "unknown"
    pdf = next(link for link in p.links if link["kind"] == "pdf_link")
    assert pdf["url"] == "https://arxiv.org/pdf/hep-th/9901001v2" and pdf["version"] == "v2"
    other = next(link for link in p.links if "2401.12345v3" in link["url"])
    assert other["kind"] == "related_reference"


@pytest.mark.parametrize("secret", ["dummy\nsecret", "dummy\u2603secret"])
def test_malformed_header_configuration_does_not_escape(secret):
    async def check():
        def forbidden(req):
            raise AssertionError("Invalid secret should never reach HTTP transport")
        async with httpx.AsyncClient(transport=httpx.MockTransport(forbidden)) as client:
            t = Transport(client=client, api_key=secret)
            with pytest.raises(TransportError) as exc:
                await t.get("openalex", "/works")
            assert exc.value.code == "invalid_configuration"
            assert "dummy" not in str(exc.value)
    run(check())
