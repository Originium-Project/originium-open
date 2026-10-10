import pytest

from originium_research_mcp.identifiers import doi, arxiv_id, openalex_id, safe_link
from originium_research_mcp.providers import arxiv, crossref, openalex
from originium_research_mcp.transport import TransportError


@pytest.mark.parametrize("value", ["10.1234/Ab.C", "doi:10.1234/Ab.C", "https://doi.org/10.1234/Ab.C", "https://dx.doi.org/10.1234%2FAb.C"])
def test_doi_variants(value):
    assert doi(value) == "10.1234/ab.c"


@pytest.mark.parametrize("value", ["https://evil.example/10.1234/x", "https://doi.org@evil.example/10.1234/x", "10.1234/x\nother", "https://doi.org/10.1234/x?bad"])
def test_bad_doi(value):
    with pytest.raises(ValueError):
        doi(value)


@pytest.mark.parametrize("value", ["2401.12345v2", "math/0301234v1", "https://arxiv.org/abs/2401.12345"])
def test_arxiv_ids(value):
    assert arxiv_id(value)


def test_invalid_links_and_ids():
    assert openalex_id("https://openalex.org/W123") == "W123"
    for link in ["file:///tmp/a", "https://user:pass@example.org/a", "http://127.0.0.1/a", "http://[::1]/a", "https://localhost/a", "https://example.org/\nsecret"]:
        assert safe_link(link) is None
    assert safe_link("https://example.org/paper")


def test_crossref_dates_and_tdm():
    paper = crossref({"DOI": "10.1234/X", "title": ["Title"], "type": "journal-article", "published-print": {"date-parts": [[2024, 1]]},
                      "published-online": {"date-parts": [[2023, 12, 2]]}, "link": [{"URL": "https://publisher.example/tdm", "content-type": "application/pdf"}]})
    assert paper.published_print == "2024-01"
    assert paper.published_online == "2023-12-02"
    assert paper.links[-1]["open_access"] is None
    assert paper.links[-1]["kind"] == "publisher_or_tdm"


def test_openalex_location_version_and_unknown():
    paper = openalex({"id": "https://openalex.org/W123", "display_name": "A", "best_oa_location": {
        "landing_page_url": "https://repository.example/item", "is_oa": True, "version": "acceptedVersion"},
        "primary_location": {"pdf_url": "https://publisher.example/file.pdf"}})
    assert paper.links[0]["open_access"] is True
    assert paper.links[0]["version"] == "acceptedVersion"
    assert paper.links[1]["open_access"] is None
    assert paper.links[1]["version"] == "unknown"
    assert paper.abstract is None


ATOM = b'''<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
<entry><id>https://arxiv.org/abs/2401.12345v2</id><title>Preprint</title><author><name>A B</name></author>
<arxiv:doi>10.1234/P</arxiv:doi><arxiv:journal_ref>Journal 2</arxiv:journal_ref><summary>Abstract</summary></entry></feed>'''


def test_arxiv_stays_preprint():
    paper = arxiv(ATOM)[0]
    assert paper.version == "v2"
    assert paper.publication_type == "preprint"
    assert paper.doi == "10.1234/p"


def test_arxiv_error_and_entities():
    error = b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/api/errors#bad</id><title>Error</title></entry></feed>'
    with pytest.raises(TransportError) as exc:
        arxiv(error)
    assert exc.value.code == "provider_error"
    with pytest.raises(TransportError):
        arxiv(b'<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]><feed>&x;</feed>')
