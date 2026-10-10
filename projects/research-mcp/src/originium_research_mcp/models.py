"""Small plain data model for provider records and failures."""
from dataclasses import dataclass, field, asdict


@dataclass
class Paper:
    source: str
    source_id: str
    title: str
    authors: list[str] = field(default_factory=list)
    doi: str | None = None
    arxiv_id: str | None = None
    publication_type: str = "unknown"
    version: str = "unknown"
    published_print: str | None = None
    published_online: str | None = None
    published: str | None = None
    updated: str | None = None
    abstract: str | None = None
    journal: str | None = None
    links: list[dict] = field(default_factory=list)
    group_key: str | None = None
    retrieved_at: str | None = None
    cached: bool = False
    warnings: list[str] = field(default_factory=list)

    def as_dict(self):
        result = asdict(self)
        result["group_key"] = "doi:" + self.doi if self.doi else self.source + ":" + self.source_id
        return result


def failure(provider, code, retry_after=None):
    result = {"provider": provider, "code": code}
    if retry_after is not None:
        result["retry_after_seconds"] = retry_after
    return result
