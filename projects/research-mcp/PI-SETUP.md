# Connect Research MCP to Pi

## Prerequisites

- This checkout's dependencies installed in `.venv` as described in [README.md](README.md).
- Pi with the `pi-mcp-extension` package already installed. Compatibility was checked with Pi0.87.1 and extension1.5.0; other versions require verification.
- One research MCP instance per operator. Do not run a separate terminal instance while starting it in Pi.

## Configuration

Adapt [example-client-config.json](example-client-config.json):

1. Replace `/ABSOLUTE/PATH/TO/research-mcp` with the full absolute nested component directory ending in `projects/research-mcp`, not the monorepo root.
2. Replace `/ABSOLUTE/PATH/TO/HOME` with your home directory.
3. Merge only its `research` entry into `~/.pi/agent/mcp.json`. Preserve your other entries/settings and keep the configuration private (mode0600 on POSIX).

The `command` and `args` select a fixed virtualenv interpreter with `-P` and explicit `PYTHONPATH`, preventing a caller's working directory from shadowing the package. `env -i` discards unrelated credentials and proxy variables. The example intentionally starts **without an OpenAlex key**; merely exporting one in Pi's parent environment will not forward it. Do not add secrets to argv. Optional key forwarding requires separate, credential-safe configuration.

## Start and check

In Pi, enter these commands **one at a time**:

```text
/reload
/mcp:start research
```

Then check:

```text
/mcp research
```

It should report **`State: ready`**. A stopped state with zero retries and no stderr is not evidence of a working connection. `/reload` loads configuration but does not start lazy servers; it also stops an already running instance. **Do not reload immediately after starting.**

The available tool names are:

- `mcp_research_search_papers`
- `mcp_research_lookup_paper`
- `mcp_research_find_access`
- `mcp_research_edinburgh_access`
- `mcp_research_provider_status`

Try:

> Search Crossref and arXiv for cryptocurrency momentum papers, two results per source.

> Give me the Edinburgh library link for DOI 10.2469/faj.v58.n4.2453.

Stop with `/mcp:stop research`. To move to another Pi session, stop it in the first session before starting it in the second. Do not change state directories to bypass the single-instance safeguard.

## Provider limitations

Crossref/arXiv search and OpenAlex DOI metadata retrieval were observed working. Anonymous OpenAlex **search** returned429 in the recorded checks. The MCP preserves other providers' results and reports partial errors. An optional key may increase the documented budget; neither availability nor paid access is guaranteed.

Edinburgh integration only generates official browser links. It does not authenticate, check holdings, request resources, or fetch papers. Complete University Login/MFA in your own browser. No institutional password or cookie should enter the MCP.

See [VALIDATION.md](VALIDATION.md) for dated evidence and the independent-review limitation. The repository contains neither an operator's real client configuration nor account credentials.
