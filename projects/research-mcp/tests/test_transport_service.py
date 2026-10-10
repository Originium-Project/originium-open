import asyncio
import json
from datetime import datetime, timezone

import httpx2 as httpx

from originium_research_mcp.service import ResearchService
from originium_research_mcp.transport import BODY_CAP, Transport, TransportError


def run(coro):
    return asyncio.run(coro)


def test_transport_headers_encoding_cache_timestamp():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"message": {"items": []}})

    clock = [0.0]
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    transport = Transport(api_key="private-key", contact_email="contact@example.org", client=client,
                          now=lambda: clock[0], wall=lambda: datetime(2024, 1, 1, tzinfo=timezone.utc))

    async def check():
        first = await transport.get("crossref", "/works", {"query": "a/b c"})
        second = await transport.get("crossref", "/works", {"query": "a/b c"})
        assert first[1] == second[1]
        assert first[2] is False and second[2] is True
        assert "a%2Fb+c" in str(requests[0].url) or "a%2Fb%20c" in str(requests[0].url)
        assert "private-key" not in str(requests[0].url)
        assert "Authorization" not in requests[0].headers
        assert "contact@example.org" in requests[0].headers["User-Agent"]
        await transport.get("openalex", "/works")
        assert requests[1].headers["Authorization"] == "Bearer private-key"
        assert "contact@example.org" not in str(requests[1].headers)
        await client.aclose()

    run(check())


def test_transport_redirect_oversize_and_cooldown():
    status = [302]
    def handler(request):
        if status[0] == 302:
            return httpx.Response(302, headers={"Location": "http://127.0.0.1/"})
        if status[0] == 429:
            return httpx.Response(429, headers={"Retry-After": "12"}, text="sensitive")
        return httpx.Response(200, content=b"x" * (BODY_CAP + 1))
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    clock = [0.0]
    transport = Transport(client=client, now=lambda: clock[0])
    async def check():
        try:
            await transport.get("crossref", "/works")
            assert False
        except TransportError as exc:
            assert exc.code == "redirect_refused"
        status[0] = 429
        clock[0] = 2
        try:
            await transport.get("crossref", "/works")
            assert False
        except TransportError as exc:
            assert exc.code == "rate_limited" and exc.retry_after == 12
            assert "sensitive" not in str(exc)
        assert transport.next_at["crossref"] >= 14
        status[0] = 200
        clock[0] = 15
        try:
            await transport.get("crossref", "/works")
            assert False
        except TransportError as exc:
            assert exc.code == "response_too_large"
        await client.aclose()
    run(check())


def test_partial_failure_and_record_separation():
    def handler(request):
        if request.url.host == "api.crossref.org":
            return httpx.Response(200, json={"message": {"items": [{"DOI": "10.1234/x", "title": ["A"]}]}})
        return httpx.Response(503, headers={"Retry-After": "1"})
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    service = ResearchService(transport=Transport(client=client), api_key="", contact_email="")
    async def check():
        response = await service.search_papers("A", ["crossref", "openalex"], 1)
        assert response["status"] == "partial"
        assert len(response["records"]) == 1
        assert response["errors"][0]["provider"] == "openalex"
        assert response["records"][0]["retrieved_at"]
        await client.aclose()
    run(check())


def test_limits_invalid_and_manual_library():
    service = ResearchService(api_key="", contact_email="")
    async def check():
        assert (await service.search_papers("x", limit=11))["status"] == "invalid_input"
        assert (await service.search_papers("x", sources=["crossref"] * 2))["status"] == "invalid_input"
        assert (await service.lookup_paper("bad"))["status"] == "invalid_input"
        await service.close()
    run(check())
    result = service.edinburgh_access(title="A & B")
    assert result["entitlement"] == "unknown"
    assert "A+%26+B" in result["discovery_url"]
