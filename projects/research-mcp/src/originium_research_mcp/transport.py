"""Bounded fixed-origin outbound requests with per-process pacing."""
import asyncio
from collections import OrderedDict
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import math
import time

import httpx2 as httpx

ORIGINS = {
    "crossref": "https://api.crossref.org",
    "openalex": "https://api.openalex.org",
    "arxiv": "https://export.arxiv.org",
}
PATHS = {
    "crossref": ("/works", "/works/"),
    "openalex": ("/works", "/works/"),
    "arxiv": ("/api/query",),
}
BODY_CAP = 2 * 1024 * 1024


class TransportError(Exception):
    def __init__(self, code, retry_after=None):
        super().__init__(code)
        self.code = code
        self.retry_after = retry_after


class Transport:
    def __init__(self, api_key=None, contact_email=None, client=None, now=None, wall=None, sleep=None):
        self.api_key = api_key
        self.contact_email = contact_email
        self.client = client or httpx.AsyncClient(trust_env=False, follow_redirects=False, timeout=15.0)
        self._own_client = client is None
        self.now = now or time.monotonic
        self.wall = wall or (lambda: datetime.now(timezone.utc))
        self.sleep = sleep or asyncio.sleep
        self.locks = {name: asyncio.Lock() for name in ORIGINS}
        self.next_at = {name: 0.0 for name in ORIGINS}
        self.cooldown_until = {name: 0.0 for name in ORIGINS}
        self.cache = OrderedDict()
        self.cache_bytes = 0

    async def close(self):
        if self._own_client:
            await self.client.aclose()

    def _retry_after(self, value):
        if not value:
            return 60
        try:
            seconds = float(value)
        except ValueError:
            try:
                seconds = (parsedate_to_datetime(value) - self.wall()).total_seconds()
            except (TypeError, ValueError, OverflowError):
                seconds = 60
        if not math.isfinite(seconds):
            seconds = 60
        # Do not shorten a server-requested cooldown, including day-long budgets.
        return max(1, math.ceil(seconds))

    def _check_cooldown(self, provider):
        remaining = self.cooldown_until[provider] - self.now()
        if remaining > 0:
            raise TransportError("rate_limited", math.ceil(remaining))

    @staticmethod
    def _header_value(value):
        if not isinstance(value, str) or len(value) > 1024 or any(not 32 <= ord(c) <= 126 for c in value):
            raise TransportError("invalid_configuration")
        return value

    async def get(self, provider, path, params=None):
        if provider not in ORIGINS or not any(path == p or (p.endswith("/") and path.startswith(p)) for p in PATHS[provider]):
            raise TransportError("invalid_request")
        if any(c in path for c in "?#\\\x00\r\n") or path.startswith("//"):
            raise TransportError("invalid_request")
        params = params or {}
        key = (provider, path, tuple(sorted(params.items())))
        ttl = 86400 if provider == "arxiv" else 3600
        cached = self.cache.get(key)
        if cached and self.now() - cached[0] < ttl:
            self.cache.move_to_end(key)
            return cached[1], cached[2], True
        self._check_cooldown(provider)
        try:
            async with asyncio.timeout(15.0):
                async with self.locks[provider]:
                    cached = self.cache.get(key)
                    if cached and self.now() - cached[0] < ttl:
                        self.cache.move_to_end(key)
                        return cached[1], cached[2], True
                    self._check_cooldown(provider)
                    delay = self.next_at[provider] - self.now()
                    if delay > 0:
                        await self.sleep(delay)
                    self.next_at[provider] = self.now() + (3 if provider == "arxiv" else 1)
                    headers = {"Accept": "application/atom+xml" if provider == "arxiv" else "application/json",
                               "Accept-Encoding": "identity", "User-Agent": "originium-research-mcp/0.1"}
                    if provider == "openalex" and self.api_key:
                        headers["Authorization"] = "Bearer " + self._header_value(self.api_key)
                    if provider == "crossref" and self.contact_email:
                        headers["User-Agent"] = "originium-research-mcp/0.1 (mailto:" + self._header_value(self.contact_email) + ")"
                    url = ORIGINS[provider] + path
                    # URL parameters are encoded by the HTTP client; never accept an input URL.
                    async with self.client.stream("GET", url, params=params, headers=headers) as response:
                        if response.status_code in (429, 503):
                            retry = self._retry_after(response.headers.get("Retry-After"))
                            self.cooldown_until[provider] = self.now() + retry
                            self.next_at[provider] = max(self.next_at[provider], self.cooldown_until[provider])
                            raise TransportError("rate_limited", retry)
                        if 300 <= response.status_code < 400:
                            raise TransportError("redirect_refused")
                        if response.status_code == 404:
                            raise TransportError("not_found")
                        if response.status_code in (401, 403):
                            raise TransportError("access_denied")
                        if response.status_code != 200:
                            raise TransportError("http_error")
                        # Refuse unsolicited compression before any decompression can allocate.
                        if response.headers.get("Content-Encoding", "identity").lower() not in {"identity", ""}:
                            raise TransportError("unsupported_encoding")
                        chunks = []
                        size = 0
                        async for chunk in response.aiter_bytes(chunk_size=65536):
                            size += len(chunk)
                            if size > BODY_CAP:
                                raise TransportError("response_too_large")
                            chunks.append(chunk)
                    body = b"".join(chunks)
                    stamp = self.wall().isoformat()
                    old = self.cache.pop(key, None)
                    if old:
                        self.cache_bytes -= len(old[1])
                    self.cache[key] = (self.now(), body, stamp)
                    self.cache_bytes += len(body)
                    while len(self.cache) > 128 or self.cache_bytes > 16 * 1024 * 1024:
                        _, evicted = self.cache.popitem(last=False)
                        self.cache_bytes -= len(evicted[1])
                    return body, stamp, False
        except TimeoutError:
            raise TransportError("timeout") from None
        except httpx.TimeoutException:
            raise TransportError("timeout") from None
        except httpx.HTTPError:
            raise TransportError("network_error") from None


def decode_json(body):
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError, RecursionError):
        raise TransportError("malformed_content") from None
