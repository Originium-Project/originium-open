"""Strict identifiers and links; output links are never fetched."""
import ipaddress
import re
from urllib.parse import quote, unquote, urlsplit

DOI_RE = re.compile(r"^10\.\d{4,9}/[^\s<>\x00-\x1f\x7f]+$", re.I)
ARXIV_RE = re.compile(r"^(?:\d{4}\.\d{4,5}|[a-z][a-z.\-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?$", re.I)
WID_RE = re.compile(r"^W\d{1,20}$", re.I)


def clean_text(value, limit=500):
    if not isinstance(value, str):
        return ""
    value = re.sub(r"<[^>]*>", " ", value)
    value = " ".join(value.split())
    return "".join(c for c in value if c.isprintable())[:limit]


def doi(value):
    if not isinstance(value, str) or len(value) > 400:
        raise ValueError("Invalid DOI")
    value = value.strip()
    if value.lower().startswith(("https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/")):
        parts = urlsplit(value)
        if parts.username or parts.password or parts.query or parts.fragment or parts.hostname not in {"doi.org", "dx.doi.org"}:
            raise ValueError("Invalid DOI URL")
        value = unquote(parts.path.lstrip("/"))
    elif value.lower().startswith("doi:"):
        value = value[4:]
    # Decode URL paths once only. Percent signs in a bare DOI are literal.
    value = value.strip()
    if not DOI_RE.fullmatch(value):
        raise ValueError("Invalid DOI")
    return value.lower()


def arxiv_id(value):
    if not isinstance(value, str) or len(value) > 100:
        raise ValueError("Invalid arXiv ID")
    value = value.strip()
    if value.lower().startswith("arxiv:"):
        value = value[6:]
    if value.startswith(("https://arxiv.org/abs/", "http://arxiv.org/abs/")):
        parts = urlsplit(value)
        if parts.query or parts.fragment or parts.username or parts.password or parts.hostname != "arxiv.org":
            raise ValueError("Invalid arXiv URL")
        value = parts.path[len("/abs/"):]
    if not ARXIV_RE.fullmatch(value):
        raise ValueError("Invalid arXiv ID")
    return value


def doi_url(value):
    return "https://doi.org/" + quote(doi(value), safe="/")


def arxiv_matches(requested, returned):
    """A bare ID selects the latest version; an explicit vN must match exactly."""
    if re.search(r"v\d+$", requested):
        return requested == returned
    return requested == re.sub(r"v\d+$", "", returned)


def literal_arxiv_query(query):
    # Treat all words as literal terms; user Boolean/field syntax is not executed.
    terms = re.findall(r"\w+(?:[.-]\w+)*", query, flags=re.UNICODE)
    if not terms:
        raise ValueError("Query has no searchable terms")
    return " AND ".join('all:"' + term + '"' for term in terms)


def openalex_id(value):
    if not isinstance(value, str) or len(value) > 100:
        raise ValueError("Invalid OpenAlex ID")
    value = value.strip()
    if value.startswith("https://openalex.org/"):
        value = value[len("https://openalex.org/"):]
    if not WID_RE.fullmatch(value):
        raise ValueError("Invalid OpenAlex ID")
    return value.upper()


def safe_link(value):
    if not isinstance(value, str) or len(value) > 2048 or "\\" in value or any(c.isspace() or ord(c) < 32 or ord(c) == 127 for c in value):
        return None
    try:
        p = urlsplit(value)
        if p.scheme.lower() not in {"http", "https"} or not p.hostname or p.username or p.password:
            return None
        host = p.hostname.rstrip(".").lower()
        if "%" in host:
            return None
        host = host.encode("idna").decode("ascii")
        if host in {"localhost", "localhost.localdomain"} or host.endswith((".localhost", ".local", ".internal", ".test", ".invalid")):
            return None
        # Browsers also recognize shortened, integer and hex IPv4 spellings.
        if "." not in host and ":" not in host:
            return None
        if re.fullmatch(r"(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+))*", host):
            try:
                ipaddress.IPv4Address(host)
            except ValueError:
                return None
        if p.port is not None and not 1 <= p.port <= 65535:
            return None
        try:
            ip = ipaddress.ip_address(host.strip("[]"))
        except ValueError:
            pass
        else:
            if not ip.is_global:
                return None
        return value
    except ValueError:
        return None
