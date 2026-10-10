"""Manual University of Edinburgh discovery links only."""
from urllib.parse import urlencode

from .identifiers import clean_text, doi as normalize_doi

DISCOVERY = "https://discovered.ed.ac.uk/discovery/search"
HELP = "https://library.ed.ac.uk/using-library/accessing-eresources/eresources-access"
RESOURCES_PLUS = "https://library.ed.ac.uk/finding-resources/library-resources-plus"


def edinburgh_access(doi=None, title=None):
    if title is not None and (not isinstance(title, str) or len(title) > 300):
        return {"status": "invalid_input", "errors": [{"code": "invalid_title"}]}
    try:
        term = normalize_doi(doi) if doi else clean_text(title, 300)
    except ValueError:
        return {"status": "invalid_input", "errors": [{"code": "invalid_doi"}]}
    if not term or any(ord(c) < 32 for c in term):
        return {"status": "invalid_input", "errors": [{"code": "missing_identifier"}]}
    return {
        "status": "manual_lookup", "provider": "university_of_edinburgh", "entitlement": "unknown",
        "auth_required": "possibly", "manual_step": "Open DiscoverEd and check availability; sign in if prompted.",
        "discovery_url": DISCOVERY + "?" + urlencode({"vid": "44UOE_INST:44UOE_VU2", "query": "any,contains," + term, "lang": "en"}),
        "library_help_url": HELP, "resources_plus_url": RESOURCES_PLUS,
    }
