"""Provider-specific normalization; preserve each provider record."""
from datetime import date
import re
from urllib.parse import urlsplit

from defusedxml import ElementTree as ET
from defusedxml.common import DefusedXmlException

from .identifiers import clean_text, safe_link, doi as normalize_doi, arxiv_id as normalize_arxiv, doi_url, openalex_id
from .models import Paper
from .transport import TransportError


def _doi(value):
    try:
        return normalize_doi(value)
    except ValueError:
        return None


def _list(value):
    if value is None:
        return []
    if not isinstance(value, list):
        raise TransportError("malformed_content")
    return value


def _first_text(value, limit=500):
    items = _list(value)
    return clean_text(items[0], limit) if items else ""


def _link(url, kind, version="unknown", oa=None, license=None):
    url = safe_link(url)
    return {"url": url, "kind": kind, "version": version, "open_access": oa,
            "license": clean_text(license, 200) or None} if url else None


def _date(value):
    parts = value.get("date-parts") if isinstance(value, dict) else None
    if not isinstance(parts, list) or not parts or not isinstance(parts[0], list) or not 1 <= len(parts[0]) <= 3:
        return None
    components = parts[0]
    if any(type(p) is not int for p in components):
        return None
    try:
        date(*(components + [1] * (3 - len(components))))
        return "-".join(f"{p:02d}" if i else f"{p:04d}" for i, p in enumerate(components))
    except (TypeError, ValueError, OverflowError):
        return None


def crossref(item):
    if not isinstance(item, dict):
        raise TransportError("malformed_content")
    ident = _doi(item.get("DOI"))
    if not ident:
        raise TransportError("malformed_content")
    title = _first_text(item.get("title"))
    authors = []
    source_authors = _list(item.get("author"))
    for a in source_authors[:30]:
        if isinstance(a, dict):
            name = clean_text(" ".join(str(a.get(k) or "") for k in ("given", "family")), 120)
            if name:
                authors.append(name)
    links = []
    for candidate in (_link(doi_url(ident), "doi"), _link(item.get("URL"), "publisher")):
        if candidate and candidate not in links:
            links.append(candidate)
    for entry in _list(item.get("link"))[:15]:
        if isinstance(entry, dict):
            candidate = _link(entry.get("URL"), "publisher_or_tdm", "unknown", None)
            if candidate and candidate not in links:
                links.append(candidate)
    return Paper("crossref", ident, title, authors, ident, publication_type=clean_text(item.get("type"), 80) or "unknown",
                 published_print=_date(item.get("published-print")), published_online=_date(item.get("published-online")),
                 published=_date(item.get("published")), journal=_first_text(item.get("container-title"), 200) or None, links=links,
                 warnings=["authors_truncated"] if len(source_authors) > 30 else [])


def openalex(item):
    if not isinstance(item, dict):
        raise TransportError("malformed_content")
    try:
        ident = openalex_id(item.get("id"))
    except ValueError:
        raise TransportError("malformed_content") from None
    paper_doi = _doi(item.get("doi"))
    authors = []
    source_authors = _list(item.get("authorships"))
    for a in source_authors[:30]:
        if isinstance(a, dict) and isinstance(a.get("author"), dict):
            name = clean_text(a["author"].get("display_name"), 120)
            if name:
                authors.append(name)
    links = []
    for loc in [item.get("best_oa_location"), item.get("primary_location"), *_list(item.get("locations"))[:12]]:
        if not isinstance(loc, dict):
            continue
        version = clean_text(loc.get("version"), 40) or "unknown"
        oa = loc.get("is_oa") if isinstance(loc.get("is_oa"), bool) else None
        for field, kind in (("landing_page_url", "landing_page"), ("pdf_url", "pdf_link")):
            candidate = _link(loc.get(field), kind, version, oa, loc.get("license"))
            if candidate and candidate not in links:
                links.append(candidate)
    for candidate in (_link("https://openalex.org/" + ident, "record"), _link(doi_url(paper_doi), "doi") if paper_doi else None):
        if candidate and candidate not in links:
            links.append(candidate)
    return Paper("openalex", ident, clean_text(item.get("display_name")), authors, paper_doi,
                 publication_type=clean_text(item.get("type"), 80) or "unknown", published=clean_text(item.get("publication_date"), 30) or None,
                 links=links, warnings=["authors_truncated"] if len(source_authors) > 30 else [])


ATOM = "{http://www.w3.org/2005/Atom}"
ARXIV = "{http://arxiv.org/schemas/atom}"


def arxiv(body):
    try:
        root = ET.fromstring(body)
    except (ET.ParseError, DefusedXmlException):
        raise TransportError("malformed_content") from None
    if root.tag != ATOM + "feed":
        raise TransportError("malformed_content")
    result = []
    for entry in root.findall(ATOM + "entry")[:10]:
        raw_id = clean_text(entry.findtext(ATOM + "id"), 200)
        title = clean_text(entry.findtext(ATOM + "title"))
        if "/api/errors" in raw_id.lower():
            raise TransportError("provider_error")
        try:
            ident = normalize_arxiv(raw_id)
        except ValueError:
            raise TransportError("malformed_content") from None
        source_authors = entry.findall(ATOM + "author")
        authors = [clean_text(a.findtext(ATOM + "name"), 120) for a in source_authors[:30]]
        match = re.search(r"v\d+$", ident)
        version = match.group() if match else "unspecified"
        journal_ref = clean_text(entry.findtext(ARXIV + "journal_ref"), 200)
        paper_doi = _doi(entry.findtext(ARXIV + "doi"))
        links = [_link("https://arxiv.org/abs/" + ident, "record", version)]
        for node in entry.findall(ATOM + "link")[:20]:
            url = safe_link(node.get("href"))
            if not url:
                continue
            parts = urlsplit(url)
            is_arxiv = parts.hostname in {"arxiv.org", "export.arxiv.org"}
            referenced_id = parts.path[5:].removesuffix(".pdf")
            same_record = referenced_id in {ident, re.sub(r"v\d+$", "", ident)}
            if is_arxiv and same_record and parts.path.startswith(("/abs/", "/pdf/")):
                # Pin content links to the source record's edition, not a changing latest URL.
                kind = "pdf_link" if parts.path.startswith("/pdf/") else "record"
                path = "/pdf/" if kind == "pdf_link" else "/abs/"
                candidate = _link("https://arxiv.org" + path + ident, kind, version)
            else:
                # Journal DOI/related references are NOT this preprint's full text/version.
                candidate = _link(url, "related_reference", "unknown")
            if candidate and candidate not in links:
                links.append(candidate)
        result.append(Paper("arxiv", ident, title, [a for a in authors if a], paper_doi, ident,
                            "preprint", version, published=clean_text(entry.findtext(ATOM + "published"), 40) or None,
                            updated=clean_text(entry.findtext(ATOM + "updated"), 40) or None,
                            abstract=clean_text(entry.findtext(ATOM + "summary"), 2000) or None,
                            journal=journal_ref or None, links=[x for x in links if x],
                            warnings=["authors_truncated"] if len(source_authors) > 30 else []))
    return result
